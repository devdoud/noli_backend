import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { envSegment } from '../media/image-slots';

const API_BASE = 'https://api.cloudflare.com/client/v4/accounts';
const REQUEST_TIMEOUT_MS = 30_000;

export interface StreamVideo {
  uid: string;
  readyToStream?: boolean;
  status?: {
    state?: string;
    errorReasonCode?: string;
    errorReasonText?: string;
  };
  duration?: number;
  meta?: Record<string, unknown>;
}

export interface StreamMeta {
  name: string;
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
}

interface CloudflareEnvelope<T> {
  success?: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

class StreamRequestError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
  ) {
    super(message);
  }
}

// The only place that talks to Cloudflare Stream (spec 0006). Missing
// variables never stop the boot: each capability is gated on its own, so a
// pasted link still plays when the Cloudflare keys are absent (AC-15).
@Injectable()
export class StreamClient {
  private readonly logger = new Logger(StreamClient.name);
  // Its own JwtService: the AuthModule one is configured with the app's
  // HS256 secret and an expiresIn, neither of which fits playback tokens.
  private readonly jwt = new JwtService({});
  private readonly accountId: string | undefined;
  private readonly apiToken: string | undefined;
  private readonly customerCode: string | undefined;
  private readonly signingKeyId: string | undefined;
  private readonly signingKey: string | undefined;
  private readonly webhookSecret: string | undefined;
  readonly env: string;

  constructor(config: ConfigService) {
    const read = (key: string) => config.get<string>(key) || undefined;
    this.env = envSegment(config.get<string>('NODE_ENV'));
    this.accountId = read('CLOUDFLARE_ACCOUNT_ID');
    this.apiToken = read('CLOUDFLARE_STREAM_API_TOKEN');
    this.customerCode = read('CLOUDFLARE_STREAM_CUSTOMER_CODE');
    this.signingKeyId = read('CLOUDFLARE_STREAM_SIGNING_KEY_ID');
    const pem = read('CLOUDFLARE_STREAM_SIGNING_KEY_PEM');
    // Cloudflare returns the key base64 encoded; stored as is in the env.
    this.signingKey = pem
      ? Buffer.from(pem, 'base64').toString('utf8')
      : undefined;
    this.webhookSecret = read('CLOUDFLARE_STREAM_WEBHOOK_SECRET');

    const missing = [
      ['CLOUDFLARE_ACCOUNT_ID', this.accountId],
      ['CLOUDFLARE_STREAM_API_TOKEN', this.apiToken],
      ['CLOUDFLARE_STREAM_CUSTOMER_CODE', this.customerCode],
      ['CLOUDFLARE_STREAM_SIGNING_KEY_ID', this.signingKeyId],
      ['CLOUDFLARE_STREAM_SIGNING_KEY_PEM', pem],
      ['CLOUDFLARE_STREAM_WEBHOOK_SECRET', this.webhookSecret],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      this.logger.warn(
        `Cloudflare Stream variables missing (${missing.join(', ')}): the matching video features will answer 503`,
      );
    }
  }

  // Upload, import, refresh, delete (AC-15).
  canManage(): boolean {
    return Boolean(this.accountId && this.apiToken);
  }

  // Signed playback (AC-15).
  canPlay(): boolean {
    return Boolean(this.customerCode && this.signingKeyId && this.signingKey);
  }

  canReceiveWebhooks(): boolean {
    return Boolean(this.webhookSecret);
  }

  get webhookSigningSecret(): string | undefined {
    return this.webhookSecret;
  }

  // Basic one time upload, for files up to 200 MB.
  async createDirectUpload(opts: {
    maxDurationSeconds: number;
    expiry: Date;
    meta: StreamMeta;
  }): Promise<{ uid: string; uploadUrl: string }> {
    const result = await this.call<{ uid: string; uploadURL: string }>(
      'POST',
      '/stream/direct_upload',
      {
        maxDurationSeconds: opts.maxDurationSeconds,
        expiry: opts.expiry.toISOString(),
        requireSignedURLs: true,
        meta: this.metaWithEnv(opts.meta),
      },
    );
    return { uid: result.uid, uploadUrl: result.uploadURL };
  }

  // Resumable (tus) one time upload, for files above 200 MB. The admin's
  // client then sends the file to the returned URL with the tus protocol.
  async createTusUpload(opts: {
    uploadLength: number;
    maxDurationSeconds: number;
    expiry: Date;
    meta: StreamMeta;
  }): Promise<{ uid: string; uploadUrl: string }> {
    this.assertCanManage();
    const b64 = (value: string) =>
      Buffer.from(value, 'utf8').toString('base64');
    const metadata = [
      `maxDurationSeconds ${b64(String(opts.maxDurationSeconds))}`,
      'requiresignedurls',
      `expiry ${b64(opts.expiry.toISOString())}`,
      `name ${b64(opts.meta.name)}`,
    ].join(',');

    let res: Response;
    try {
      res = await fetch(`${this.base()}/stream?direct_user=true`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Tus-Resumable': '1.0.0',
          'Upload-Length': String(opts.uploadLength),
          'Upload-Metadata': metadata,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw this.unavailable('tus upload', err);
    }
    const location = res.headers.get('location');
    if (!res.ok || !location) {
      throw this.unavailable('tus upload', `HTTP ${res.status}`);
    }
    // The uid is the last path segment of the upload URL; Cloudflare also
    // sends it as stream-media-id, which is preferred when present.
    const uid =
      res.headers.get('stream-media-id') ??
      new URL(location).pathname.split('/').filter(Boolean).pop() ??
      '';
    if (!uid) {
      throw this.unavailable('tus upload', 'no video id in the response');
    }
    // tus metadata has no free meta field: set it afterwards so webhooks
    // carry the environment marker too. Best effort.
    try {
      await this.call('POST', `/stream/${uid}`, {
        meta: this.metaWithEnv(opts.meta),
      });
    } catch (err) {
      this.logger.warn(
        `Could not set meta on tus video ${uid}: ${String(err)}`,
      );
    }
    return { uid, uploadUrl: location };
  }

  // Cloudflare downloads the file itself from a public link.
  async copyFromUrl(opts: {
    url: string;
    meta: StreamMeta;
  }): Promise<{ uid: string }> {
    try {
      const result = await this.call<{ uid: string }>('POST', '/stream/copy', {
        url: opts.url,
        requireSignedURLs: true,
        meta: this.metaWithEnv(opts.meta),
      });
      return { uid: result.uid };
    } catch (err) {
      if (
        err instanceof StreamRequestError &&
        err.httpStatus !== null &&
        err.httpStatus >= 400 &&
        err.httpStatus < 500
      ) {
        throw new BadRequestException(
          `Lien vidéo refusé par Cloudflare : ${err.message}`,
        );
      }
      throw err;
    }
  }

  async getVideo(uid: string): Promise<StreamVideo> {
    return this.call<StreamVideo>('GET', `/stream/${encodeURIComponent(uid)}`);
  }

  // Never throws: the database is the truth, a stray video only costs
  // storage. A 404 means it is already gone.
  async deleteVideo(uid: string | null | undefined): Promise<void> {
    if (!uid) return;
    if (!this.canManage()) {
      this.logger.warn(
        `Cloudflare Stream not configured, could not delete video ${uid}`,
      );
      return;
    }
    try {
      await this.call('DELETE', `/stream/${encodeURIComponent(uid)}`);
    } catch (err) {
      if (err instanceof StreamRequestError && err.httpStatus === 404) return;
      this.logger.error(
        `Cloudflare Stream delete failed for ${uid}: ${String(err)}`,
      );
    }
  }

  // RS256 token for one video (spec 0006 AC-7). exp is in the payload, so no
  // expiresIn option; Cloudflare refuses an exp more than 24 hours ahead.
  signPlaybackToken(uid: string, expiresAt: Date): string {
    if (!this.canPlay()) {
      throw new ServiceUnavailableException('Lecture vidéo indisponible');
    }
    const now = Math.floor(Date.now() / 1000);
    return this.jwt.sign(
      {
        sub: uid,
        kid: this.signingKeyId,
        exp: Math.floor(expiresAt.getTime() / 1000),
        nbf: now - 60,
      },
      {
        algorithm: 'RS256',
        privateKey: this.signingKey,
        keyid: this.signingKeyId,
        noTimestamp: true,
      },
    );
  }

  manifestUrl(token: string): string {
    return `https://customer-${this.customerCode}.cloudflarestream.com/${token}/manifest/video.m3u8`;
  }

  // Cloudflare Stream only accepts string values in meta: a number makes
  // direct_upload answer 400 and the tus meta update fail to decode.
  private metaWithEnv(meta: StreamMeta): Record<string, string> {
    return {
      name: meta.name,
      seriesId: meta.seriesId,
      seasonNumber: String(meta.seasonNumber),
      episodeNumber: String(meta.episodeNumber),
      env: this.env,
    };
  }

  private base(): string {
    return `${API_BASE}/${this.accountId}`;
  }

  private assertCanManage(): void {
    if (!this.canManage()) {
      throw new ServiceUnavailableException('Service vidéo indisponible');
    }
  }

  private async call<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    this.assertCanManage();
    let res: Response;
    try {
      res = await fetch(`${this.base()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(
        `Cloudflare Stream ${method} ${path} failed: ${String(err)}`,
      );
      throw new ServiceUnavailableException('Service vidéo indisponible');
    }
    let json: CloudflareEnvelope<T> = {};
    try {
      json = (await res.json()) as CloudflareEnvelope<T>;
    } catch {
      // DELETE may answer with an empty body.
    }
    if (!res.ok || json.success === false) {
      const message =
        json.errors
          ?.map((e) => e.message)
          .filter(Boolean)
          .join('; ') || `HTTP ${res.status}`;
      // A client error (bad link, unknown video) is the caller's to map;
      // anything else is an outage.
      if (res.status >= 400 && res.status < 500) {
        throw new StreamRequestError(message, res.status);
      }
      this.logger.error(`Cloudflare Stream ${method} ${path}: ${message}`);
      throw new ServiceUnavailableException('Service vidéo indisponible');
    }
    return json.result as T;
  }

  private unavailable(
    what: string,
    detail: unknown,
  ): ServiceUnavailableException {
    this.logger.error(`Cloudflare Stream ${what} failed: ${String(detail)}`);
    return new ServiceUnavailableException('Service vidéo indisponible');
  }
}

export { StreamRequestError };
