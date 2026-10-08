import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import {
  IMAGE_SLOTS,
  ImageSlot,
  SlotOwner,
  categoryFolder,
  envSegment,
  episodeThumbnailPrefix,
  seriesFolder,
  slotPrefix,
} from './image-slots';
import { validateImage } from './validate-image';

// Destructive prefix deletes must stay inside one owner's folder.
const SAFE_PREFIX =
  /^noli\/[a-z0-9-]+\/(series|categories|users)\/[a-f0-9]{24}\//;
const UPLOAD_TIMEOUT_MS = 30_000;
const MAX_PREFIX_ROUNDS = 5;

export interface ReplaceImageOptions<T> {
  file: Express.Multer.File | undefined;
  slot: ImageSlot;
  owner: SlotOwner;
  currentUrl: string | null;
  // Compare and set: write newUrl only if the slot still holds oldUrl.
  save: (oldUrl: string | null, newUrl: string) => Promise<T | null>;
  exists: () => Promise<boolean>;
  notFoundMessage: string;
}

export interface RemoveImageOptions<T> {
  slot: ImageSlot;
  owner: SlotOwner;
  current: T;
  currentUrl: string | null;
  save: (oldUrl: string) => Promise<T | null>;
  exists: () => Promise<boolean>;
  notFoundMessage: string;
}

// The only place that talks to Cloudinary (spec 0005). Destroy calls never
// throw: the database is the truth, a stray file is harmless.
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly configured: boolean;
  private readonly cloudName: string | undefined;
  readonly env: string;

  constructor(config: ConfigService) {
    this.env = envSegment(config.get<string>('NODE_ENV'));
    const cloudName = config.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = config.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = config.get<string>('CLOUDINARY_API_SECRET');
    this.configured = Boolean(cloudName && apiKey && apiSecret);
    this.cloudName = cloudName || undefined;
    if (this.configured) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      });
    } else {
      this.logger.warn(
        'Cloudinary keys missing (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET): image uploads will answer 503',
      );
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  slotPrefix(slot: ImageSlot, owner: SlotOwner): string {
    return slotPrefix(this.env, slot, owner);
  }

  seriesFolder(seriesId: string): string {
    return seriesFolder(this.env, seriesId);
  }

  categoryFolder(categoryId: string): string {
    return categoryFolder(this.env, categoryId);
  }

  episodeThumbnailPrefix(
    seriesId: string,
    seasonNumber: number,
    episodeNumber: number,
  ): string {
    return episodeThumbnailPrefix(
      this.env,
      seriesId,
      seasonNumber,
      episodeNumber,
    );
  }

  // Upload flow steps 1 to 7 of spec 0005, shared by every PUT route.
  async replaceImage<T>(opts: ReplaceImageOptions<T>): Promise<T> {
    if (!this.configured) {
      throw this.unavailable();
    }
    validateImage(opts.file, opts.slot);

    const prefix = this.slotPrefix(opts.slot, opts.owner);
    const { url, publicId } = await this.uploadImage(
      opts.file!.buffer,
      opts.slot,
      prefix,
    );

    let saved: T | null;
    try {
      saved = await opts.save(opts.currentUrl, url);
    } catch (err) {
      await this.destroy(publicId);
      throw err;
    }

    if (!saved) {
      await this.destroy(publicId);
      if (!(await opts.exists())) {
        throw new NotFoundException(opts.notFoundMessage);
      }
      throw new ConflictException("L'image a changé entre temps, réessayez");
    }

    const oldId = this.ownedPublicId(opts.currentUrl, prefix);
    if (oldId) {
      await this.destroy(oldId);
    }
    return saved;
  }

  // Remove flow of spec 0005, shared by every DELETE route.
  async removeImage<T>(opts: RemoveImageOptions<T>): Promise<T> {
    if (!opts.currentUrl) {
      return opts.current;
    }
    const oldId = this.ownedPublicId(
      opts.currentUrl,
      this.slotPrefix(opts.slot, opts.owner),
    );
    if (oldId && !this.configured) {
      throw this.unavailable();
    }

    const saved = await opts.save(opts.currentUrl);
    if (!saved) {
      if (!(await opts.exists())) {
        throw new NotFoundException(opts.notFoundMessage);
      }
      throw new ConflictException("L'image a changé entre temps, réessayez");
    }

    if (oldId) {
      await this.destroy(oldId);
    }
    return saved;
  }

  // Deletes the old file behind a URL, if this feature uploaded it for this
  // exact owner and slot. Used when a pasted URL replaces an upload.
  async destroyIfOwned(
    url: string | null | undefined,
    slot: ImageSlot,
    owner: SlotOwner,
  ): Promise<void> {
    const id = this.ownedPublicId(url, this.slotPrefix(slot, owner));
    if (id) {
      await this.destroy(id);
    }
  }

  async uploadImage(
    buffer: Buffer,
    slot: ImageSlot,
    prefix: string,
  ): Promise<{ url: string; publicId: string }> {
    const spec = IMAGE_SLOTS[slot];
    const publicId = `${prefix}${randomBytes(6).toString('hex')}`;

    let result: UploadApiResponse;
    try {
      result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            public_id: publicId,
            resource_type: 'image',
            overwrite: false,
            timeout: UPLOAD_TIMEOUT_MS,
            transformation: [
              {
                width: spec.width,
                height: spec.height,
                crop: 'fill',
                gravity: spec.gravity,
              },
            ],
          },
          (error, res) => {
            // The SDK reports a failure in either argument, as a plain
            // object carrying http_code; keep that code on a real Error.
            const failure = (error ??
              (res as { error?: unknown } | undefined)?.error) as
              { message?: string; http_code?: number } | undefined;
            if (failure || !res) {
              reject(
                Object.assign(
                  new Error(failure?.message ?? 'Empty Cloudinary response'),
                  { http_code: failure?.http_code },
                ),
              );
              return;
            }
            resolve(res);
          },
        );
        stream.end(buffer);
      });
    } catch (err) {
      const httpCode = (err as { http_code?: number })?.http_code;
      this.logger.error(
        `Cloudinary upload failed for ${publicId}: ${(err as Error)?.message ?? err}`,
      );
      if (httpCode === 400) {
        throw new BadRequestException('Image invalide');
      }
      throw this.unavailable();
    }

    const url = cloudinary.url(result.public_id, {
      secure: true,
      version: result.version,
      fetch_format: 'auto',
      quality: 'auto',
      // The SDK appends a ?_a=... tracking parameter by default; keep the
      // stored URL clean and stable.
      urlAnalytics: false,
    });
    return { url, publicId: result.public_id };
  }

  async destroy(publicId: string): Promise<void> {
    if (!this.configured) {
      this.logger.warn(
        `Cloudinary not configured, could not delete ${publicId}`,
      );
      return;
    }
    try {
      await cloudinary.uploader.destroy(publicId, { invalidate: true });
    } catch (err) {
      this.logger.error(
        `Cloudinary delete failed for ${publicId}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  async destroyByPrefix(prefix: string): Promise<void> {
    if (!SAFE_PREFIX.test(prefix)) {
      this.logger.error(
        `Refused Cloudinary prefix delete outside an owner folder: ${prefix}`,
      );
      return;
    }
    if (!this.configured) {
      this.logger.warn(`Cloudinary not configured, could not clean ${prefix}`);
      return;
    }
    try {
      let nextCursor: string | undefined;
      for (let round = 0; round < MAX_PREFIX_ROUNDS; round++) {
        const res = (await cloudinary.api.delete_resources_by_prefix(prefix, {
          invalidate: true,
          ...(nextCursor ? { next_cursor: nextCursor } : {}),
        } as Record<string, unknown>)) as
          { partial?: boolean; next_cursor?: string } | undefined;
        if (!res?.partial) {
          return;
        }
        nextCursor = res.next_cursor;
      }
      this.logger.warn(
        `Cloudinary prefix delete still partial after ${MAX_PREFIX_ROUNDS} rounds: ${prefix}`,
      );
    } catch (err) {
      this.logger.error(
        `Cloudinary prefix delete failed for ${prefix}: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  // The public id behind a URL this feature built, only when it sits under
  // ownerSlotPrefix; a pasted URL, another cloud, another owner, slot, or
  // environment all give null.
  ownedPublicId(
    url: string | null | undefined,
    ownerSlotPrefix: string,
  ): string | null {
    if (!url) {
      return null;
    }
    // Without keys the cloud name may be unknown; the owner folder check
    // below still applies, so a remove can answer 503 instead of silently
    // orphaning an uploaded file (spec 0005 AC-12).
    const cloud = this.cloudName ? escapeRegExp(this.cloudName) : '[^/]+';
    const match = new RegExp(
      // A trailing query string is allowed: URLs stored before analytics was
      // turned off carry the SDK's ?_a=... parameter.
      `^https://res\\.cloudinary\\.com/${cloud}/image/upload/(?:[^/]+/)*?v\\d+/([^?#]+)(?:[?#].*)?$`,
    ).exec(url);
    if (!match) {
      return null;
    }
    const publicId = match[1];
    if (!publicId.startsWith(ownerSlotPrefix) || publicId.includes('..')) {
      return null;
    }
    return publicId;
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException('Service d’images indisponible');
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
