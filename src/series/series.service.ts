import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Error as MongooseError,
  Model,
  Types,
  isValidObjectId,
} from 'mongoose';
import { Episode, Series } from './schemas/series.schema';
import { Category } from '../categories/schemas/category.schema';
import { WatchHistoryService } from '../watch-history/watch-history.service';
import { MediaService } from '../media/media.service';
import { ImageSlot } from '../media/image-slots';
import { CreateSeriesDto } from './dto/create-series.dto';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { UpdateSeriesAccessDto } from './dto/update-series-access.dto';
import {
  EDITABLE_SERIES_FIELDS,
  UpdateSeriesDto,
} from './dto/update-series.dto';
import {
  EDITABLE_EPISODE_FIELDS,
  UpdateEpisodeDto,
} from './dto/update-episode.dto';
import {
  ADMIN_CATEGORY_POPULATE,
  CATEGORY_POPULATE,
  PREMIUM_REQUIRED,
  canPlay,
  isPlayable,
  sortEpisodes,
  toPublicEpisodes,
} from './content-access';
import { StreamClient, StreamMeta } from '../video/stream.client';
import { VideoStateService } from '../video/video-state.service';
import { NotificationQueue } from '../notifications/notification-queue';

export interface PlayableEpisode {
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  duration: number;
  videoUrl: string;
  // 'hls': a signed Cloudflare manifest that expires; 'direct': a pasted
  // legacy link (spec 0006 AC-7).
  type: 'hls' | 'direct';
  expiresAt: Date | null;
}

// Basic uploads are a single form POST, capped at 200 MB by Cloudflare;
// anything bigger goes through the resumable (tus) path (spec 0006 AC-1).
export const BASIC_UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 3 * 60 * 60;
// Cloudflare caps upload link expiry at 6 hours; keep a margin so a request
// computed on our clock is never refused.
export const UPLOAD_LINK_LIFETIME_MS = (5 * 60 + 55) * 60 * 1000;
// Cloudflare refuses a playback token whose exp is more than 24 h ahead.
const MAX_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

// A playback link outlives the viewing: twice the episode length (pauses,
// rewinds) plus one hour (spec 0006 AC-7), never beyond Cloudflare's 24 h.
export function playbackExpiry(
  now: Date,
  streamDuration: number,
  duration: number,
): Date {
  const lengthSeconds = Math.max(streamDuration || 0, duration || 0);
  const lifetimeMs = Math.min(
    (2 * lengthSeconds + 3600) * 1000,
    MAX_TOKEN_LIFETIME_MS,
  );
  return new Date(now.getTime() + lifetimeMs);
}

export interface VideoUploadTicket {
  method: 'post' | 'tus';
  uploadUrl: string;
  uid: string;
  expiresAt: Date;
}

export type SeriesImageField = 'coverImage' | 'bannerImage';

const SERIES_IMAGE_SLOTS: Record<SeriesImageField, ImageSlot> = {
  coverImage: 'seriesCover',
  bannerImage: 'seriesBanner',
};

@Injectable()
export class SeriesService {
  constructor(
    @InjectModel(Series.name) private seriesModel: Model<Series>,
    @InjectModel(Category.name) private categoryModel: Model<Category>,
    private readonly watchHistoryService: WatchHistoryService,
    private readonly mediaService: MediaService,
    private readonly streamClient: StreamClient,
    private readonly videoState: VideoStateService,
    private readonly notificationQueue: NotificationQueue,
  ) {}

  // ---- Episode videos (spec 0006) ----

  // POST .../video/upload (AC-1, AC-11).
  async requestVideoUpload(
    id: string,
    seasonNumber: number,
    episodeNumber: number,
    uploadLength: number,
  ): Promise<VideoUploadTicket> {
    const { series, episode } = await this.loadEpisodeForImage(
      id,
      seasonNumber,
      episodeNumber,
    );
    this.assertCanManageVideo();
    const meta = this.streamMeta(series, episode, id);
    const expiresAt = new Date(Date.now() + UPLOAD_LINK_LIFETIME_MS);
    const method = uploadLength <= BASIC_UPLOAD_MAX_BYTES ? 'post' : 'tus';
    const created =
      method === 'post'
        ? await this.streamClient.createDirectUpload({
            maxDurationSeconds: MAX_VIDEO_SECONDS,
            expiry: expiresAt,
            meta,
          })
        : await this.streamClient.createTusUpload({
            uploadLength,
            maxDurationSeconds: MAX_VIDEO_SECONDS,
            expiry: expiresAt,
            meta,
          });

    await this.savePendingVideo(id, seasonNumber, episodeNumber, {
      oldPending: episode.pendingStreamUid ?? null,
      uid: created.uid,
      status: 'awaiting_upload',
      expiresAt,
    });
    return { method, uploadUrl: created.uploadUrl, uid: created.uid, expiresAt };
  }

  // POST .../video/import (AC-2, AC-11).
  async importVideo(
    id: string,
    seasonNumber: number,
    episodeNumber: number,
    url: string,
  ): Promise<{ uid: string; pendingStatus: 'processing' }> {
    const { series, episode } = await this.loadEpisodeForImage(
      id,
      seasonNumber,
      episodeNumber,
    );
    this.assertCanManageVideo();
    const { uid } = await this.streamClient.copyFromUrl({
      url,
      meta: this.streamMeta(series, episode, id),
    });
    await this.savePendingVideo(id, seasonNumber, episodeNumber, {
      oldPending: episode.pendingStreamUid ?? null,
      uid,
      status: 'processing',
      expiresAt: null,
    });
    return { uid, pendingStatus: 'processing' };
  }

  // POST .../video/refresh (AC-6, AC-16): asks Cloudflare directly, for a
  // missed webhook or local development.
  async refreshVideo(
    id: string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<Series> {
    const { episode } = await this.loadEpisodeForImage(id, seasonNumber, episodeNumber);
    this.assertCanManageVideo();
    const ep = episode as {
      seasonNumber: number;
      episodeNumber: number;
      duration?: number;
      pendingStreamUid?: string | null;
      pendingStatus?: string | null;
      pendingExpiresAt?: Date | null;
    };
    const expired = await this.videoState.expireUnusedUpload(id, ep);
    if (!expired && ep.pendingStreamUid && ep.pendingStatus !== 'error') {
      const video = await this.streamClient.getVideo(ep.pendingStreamUid);
      await this.videoState.applyStreamState({ ...video, uid: ep.pendingStreamUid });
    }
    return this.findAdminPopulated(id);
  }

  // DELETE .../video (AC-12): database first, so a deleted video is never
  // referenced; then Cloudflare, best effort.
  async removeVideo(
    id: string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<Series> {
    const { episode } = await this.loadEpisodeForImage(id, seasonNumber, episodeNumber);
    const ep = episode as {
      streamUid?: string | null;
      pendingStreamUid?: string | null;
      videoUrl?: string | null;
    };
    if (!ep.streamUid && !ep.pendingStreamUid && !ep.videoUrl) {
      return this.findAdminPopulated(id);
    }
    await this.seriesModel.updateOne(
      {
        _id: id,
        episodes: { $elemMatch: { seasonNumber, episodeNumber } },
      },
      {
        $set: {
          'episodes.$.streamUid': null,
          'episodes.$.streamDuration': null,
          'episodes.$.pendingStreamUid': null,
          'episodes.$.pendingStatus': null,
          'episodes.$.pendingError': null,
          'episodes.$.pendingExpiresAt': null,
          'episodes.$.videoUrl': null,
        },
      },
    );
    await this.streamClient.deleteVideo(ep.streamUid);
    await this.streamClient.deleteVideo(ep.pendingStreamUid);
    return this.findAdminPopulated(id);
  }

  // GET /series/:id/admin (AC-10): every episode, and unused upload links
  // expired on the way (AC-16).
  async getSeriesForAdmin(id: string): Promise<Series> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Series not found');
    }
    const series = await this.findAdminPopulated(id);
    let changed = false;
    for (const ep of series.episodes as Array<{
      seasonNumber: number;
      episodeNumber: number;
      pendingStreamUid?: string | null;
      pendingStatus?: string | null;
      pendingExpiresAt?: Date | null;
    }>) {
      if (await this.videoState.expireUnusedUpload(id, ep)) changed = true;
    }
    return changed ? this.findAdminPopulated(id) : series;
  }

  private assertCanManageVideo(): void {
    if (!this.streamClient.canManage()) {
      throw new ServiceUnavailableException('Service vidéo indisponible');
    }
  }

  private streamMeta(
    series: Series,
    episode: { title?: string; seasonNumber: number; episodeNumber: number },
    id: string,
  ): StreamMeta {
    return {
      name: `${series.title} S${episode.seasonNumber}E${episode.episodeNumber} ${episode.title ?? ''}`.trim(),
      seriesId: String(id),
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
    };
  }

  // Compare and set on the pending slot (AC-11): only one request wins; the
  // loser's fresh Cloudflare video is deleted.
  private async savePendingVideo(
    id: string,
    seasonNumber: number,
    episodeNumber: number,
    next: {
      oldPending: string | null;
      uid: string;
      status: 'awaiting_upload' | 'processing';
      expiresAt: Date | null;
    },
  ): Promise<void> {
    const saved = await this.seriesModel.findOneAndUpdate(
      {
        _id: id,
        episodes: {
          $elemMatch: {
            seasonNumber,
            episodeNumber,
            pendingStreamUid: next.oldPending,
          },
        },
      },
      {
        $set: {
          'episodes.$.pendingStreamUid': next.uid,
          'episodes.$.pendingStatus': next.status,
          'episodes.$.pendingError': null,
          'episodes.$.pendingExpiresAt': next.expiresAt,
        },
      },
      { new: true },
    );
    if (!saved) {
      await this.streamClient.deleteVideo(next.uid);
      if (!(await this.episodeExists(id, seasonNumber, episodeNumber))) {
        throw new NotFoundException('Series or episode not found');
      }
      throw new ConflictException('La vidéo a changé entre temps, réessayez');
    }
    if (next.oldPending && next.oldPending !== next.uid) {
      await this.streamClient.deleteVideo(next.oldPending);
    }
  }

  async createSeries(createSeriesDto: CreateSeriesDto): Promise<Series> {
    const { title } = createSeriesDto;

    const existing = await this.seriesModel.findOne({ title });
    if (existing) {
      throw new ConflictException('Series with this title already exists');
    }

    const categoryIds = await this.validateCategoryIds(
      createSeriesDto.categoryIds,
    );

    let series: Series;
    try {
      series = await this.seriesModel.create({
        ...createSeriesDto,
        categoryIds,
        episodes: [],
        totalEpisodes: 0,
        // Announced to category fans at its first playable episode (spec 0008).
        announcedAt: null,
        status: createSeriesDto.status || 'ongoing',
      });
    } catch (err) {
      throw this.mapWriteError(err);
    }

    return this.findAdminPopulated(series._id);
  }

  // One route for every editable field (spec 0004 AC-1). runValidators only
  // checks the paths being set, so series that predate categories can still
  // be edited on other fields.
  async updateSeries(id: string, dto: UpdateSeriesDto): Promise<Series> {
    const set: Record<string, unknown> = {};
    for (const field of EDITABLE_SERIES_FIELDS) {
      if (dto[field] !== undefined) {
        set[field] = dto[field];
      }
    }
    if (Object.keys(set).length === 0) {
      throw new BadRequestException('Provide at least one field to update');
    }
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Series not found');
    }

    if (dto.categoryIds !== undefined) {
      set.categoryIds = await this.validateCategoryIds(dto.categoryIds);
    }
    if (
      dto.title !== undefined &&
      (await this.seriesModel.exists({ title: dto.title, _id: { $ne: id } }))
    ) {
      throw new ConflictException('Series with this title already exists');
    }

    const imageFields = (
      Object.keys(SERIES_IMAGE_SLOTS) as SeriesImageField[]
    ).filter((field) => set[field] !== undefined);
    if (imageFields.length > 0) {
      return this.updateSeriesWithPastedImages(id, set, imageFields);
    }

    let series: Series | null;
    try {
      series = await this.seriesModel
        .findByIdAndUpdate(
          id,
          { $set: set },
          { new: true, runValidators: true },
        )
        .populate(ADMIN_CATEGORY_POPULATE);
    } catch (err) {
      throw this.mapWriteError(err);
    }

    if (!series) {
      throw new NotFoundException('Series not found');
    }
    return series;
  }

  // A pasted coverImage/bannerImage (spec 0005 AC-9): the old values come
  // from the same atomic write, so a concurrent upload can't slip in between
  // the read and the update. An uploaded file it replaced is deleted after.
  private async updateSeriesWithPastedImages(
    id: string,
    set: Record<string, unknown>,
    imageFields: SeriesImageField[],
  ): Promise<Series> {
    let before: Pick<Series, SeriesImageField> | null;
    try {
      before = await this.seriesModel
        .findByIdAndUpdate(
          id,
          { $set: set },
          { new: false, runValidators: true },
        )
        .select('coverImage bannerImage')
        .lean();
    } catch (err) {
      throw this.mapWriteError(err);
    }
    if (!before) {
      throw new NotFoundException('Series not found');
    }

    for (const field of imageFields) {
      if (before[field] && before[field] !== set[field]) {
        await this.mediaService.destroyIfOwned(
          before[field],
          SERIES_IMAGE_SLOTS[field],
          { seriesId: String(id) },
        );
      }
    }
    return this.findAdminPopulated(id);
  }

  // PUT /series/:id/cover and /banner (spec 0005 AC-1, AC-6, AC-13).
  async setSeriesImage(
    id: string,
    field: SeriesImageField,
    file: Express.Multer.File | undefined,
  ): Promise<Series> {
    const current = await this.loadForImage(id);
    return this.mediaService.replaceImage({
      file,
      slot: SERIES_IMAGE_SLOTS[field],
      owner: { seriesId: String(id) },
      currentUrl: current[field] ?? null,
      save: (oldUrl, newUrl) =>
        this.seriesModel
          .findOneAndUpdate(
            { _id: id, [field]: oldUrl },
            { $set: { [field]: newUrl } },
            { new: true },
          )
          .populate(ADMIN_CATEGORY_POPULATE),
      exists: async () => Boolean(await this.seriesModel.exists({ _id: id })),
      notFoundMessage: 'Series not found',
    });
  }

  // DELETE /series/:id/cover and /banner (spec 0005 AC-7).
  async removeSeriesImage(id: string, field: SeriesImageField): Promise<Series> {
    const current = await this.loadForImage(id);
    return this.mediaService.removeImage({
      slot: SERIES_IMAGE_SLOTS[field],
      owner: { seriesId: String(id) },
      current,
      currentUrl: current[field] ?? null,
      save: (oldUrl) =>
        this.seriesModel
          .findOneAndUpdate(
            { _id: id, [field]: oldUrl },
            { $set: { [field]: null } },
            { new: true },
          )
          .populate(ADMIN_CATEGORY_POPULATE),
      exists: async () => Boolean(await this.seriesModel.exists({ _id: id })),
      notFoundMessage: 'Series not found',
    });
  }

  // PUT /series/:id/episodes/:s/:e/thumbnail (spec 0005 AC-2).
  async setEpisodeThumbnail(
    id: string,
    seasonNumber: number,
    episodeNumber: number,
    file: Express.Multer.File | undefined,
  ): Promise<Series> {
    const { episode } = await this.loadEpisodeForImage(
      id,
      seasonNumber,
      episodeNumber,
    );
    return this.mediaService.replaceImage({
      file,
      slot: 'episodeThumbnail',
      owner: { seriesId: String(id), seasonNumber, episodeNumber },
      currentUrl: episode.thumbnail ?? null,
      save: (oldUrl, newUrl) =>
        this.saveEpisodeThumbnail(id, seasonNumber, episodeNumber, oldUrl, newUrl),
      exists: () => this.episodeExists(id, seasonNumber, episodeNumber),
      notFoundMessage: 'Series or episode not found',
    });
  }

  // DELETE /series/:id/episodes/:s/:e/thumbnail (spec 0005 AC-7).
  async removeEpisodeThumbnail(
    id: string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<Series> {
    const { series, episode } = await this.loadEpisodeForImage(
      id,
      seasonNumber,
      episodeNumber,
    );
    return this.mediaService.removeImage({
      slot: 'episodeThumbnail',
      owner: { seriesId: String(id), seasonNumber, episodeNumber },
      current: series,
      currentUrl: episode.thumbnail ?? null,
      save: (oldUrl) =>
        this.saveEpisodeThumbnail(id, seasonNumber, episodeNumber, oldUrl, null),
      exists: () => this.episodeExists(id, seasonNumber, episodeNumber),
      notFoundMessage: 'Series or episode not found',
    });
  }

  // A thumbnail of null also matches a missing field in MongoDB, so episodes
  // saved before spec 0005 compare correctly.
  private saveEpisodeThumbnail(
    id: string,
    seasonNumber: number,
    episodeNumber: number,
    oldUrl: string | null,
    newUrl: string | null,
  ): Promise<Series | null> {
    return this.seriesModel
      .findOneAndUpdate(
        {
          _id: id,
          episodes: {
            $elemMatch: { seasonNumber, episodeNumber, thumbnail: oldUrl },
          },
        },
        { $set: { 'episodes.$.thumbnail': newUrl } },
        { new: true },
      )
      .populate(ADMIN_CATEGORY_POPULATE)
      .exec();
  }

  private async episodeExists(
    id: string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<boolean> {
    return Boolean(
      await this.seriesModel.exists({
        _id: id,
        episodes: { $elemMatch: { seasonNumber, episodeNumber } },
      }),
    );
  }

  private async loadForImage(id: string): Promise<Series> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Series not found');
    }
    return this.findAdminPopulated(id);
  }

  private async loadEpisodeForImage(
    id: string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<{ series: Series; episode: Episode }> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Series or episode not found');
    }
    const series = await this.seriesModel
      .findById(id)
      .populate(ADMIN_CATEGORY_POPULATE);
    const episode = series?.episodes.find(
      (ep) =>
        ep.seasonNumber === seasonNumber && ep.episodeNumber === episodeNumber,
    );
    if (!series || !episode) {
      throw new NotFoundException('Series or episode not found');
    }
    return { series, episode };
  }

  async getAllSeries(
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    total: number;
    page: number;
    limit: number;
    series: Series[];
  }> {
    const skip = (page - 1) * limit;

    const total = await this.seriesModel.countDocuments();
    const series = await this.seriesModel
      .find()
      .select('-episodes')
      .populate(CATEGORY_POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return {
      total,
      page,
      limit,
      series,
    };
  }

  async getSeriesById(id: string): Promise<Series> {
    const series = await this.seriesModel
      .findById(id)
      .populate(CATEGORY_POPULATE);

    if (!series) {
      throw new NotFoundException('Series not found');
    }

    return series;
  }

  async searchSeries(
    query: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    total: number;
    series: Series[];
  }> {
    const skip = (page - 1) * limit;

    const total = await this.seriesModel.countDocuments({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
      ],
    });

    const series = await this.seriesModel
      .find({
        $or: [
          { title: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } },
        ],
      })
      .select('-episodes')
      .populate(CATEGORY_POPULATE)
      .skip(skip)
      .limit(limit)
      .lean()
      .exec();

    return { total, series };
  }

  // One atomic update (spec 0004 AC-11): the filter refuses a duplicate
  // (season, episode) and $push + $inc land together, so a concurrent delete
  // can never leave totalEpisodes different from episodes.length.
  async addEpisode(
    seriesId: string,
    createEpisodeDto: CreateEpisodeDto,
  ): Promise<Series> {
    if (!isValidObjectId(seriesId)) {
      throw new NotFoundException('Series not found');
    }
    const { seasonNumber, episodeNumber } = createEpisodeDto;

    let series: Series | null;
    try {
      series = await this.seriesModel
        .findOneAndUpdate(
          {
            _id: seriesId,
            episodes: { $not: { $elemMatch: { seasonNumber, episodeNumber } } },
          },
          {
            $push: { episodes: createEpisodeDto },
            $inc: { totalEpisodes: 1 },
          },
          { new: true, runValidators: true },
        )
        .populate(ADMIN_CATEGORY_POPULATE);
    } catch (err) {
      throw this.mapWriteError(err);
    }

    if (!series) {
      if (!(await this.seriesModel.exists({ _id: seriesId }))) {
        throw new NotFoundException('Series not found');
      }
      throw new BadRequestException('Episode already exists');
    }
    // Spec 0008 AC-4/AC-5: a pasted link makes the episode playable now.
    if (createEpisodeDto.videoUrl) {
      await this.notificationQueue.episodePlayable(
        series._id,
        seasonNumber,
        episodeNumber,
      );
    }
    return series;
  }

  async updateEpisode(
    seriesId: string,
    seasonNumber: number,
    episodeNumber: number,
    dto: UpdateEpisodeDto,
  ): Promise<Series> {
    const set: Record<string, unknown> = {};
    for (const field of EDITABLE_EPISODE_FIELDS) {
      if (dto[field] !== undefined) {
        set[`episodes.$.${field}`] = dto[field];
      }
    }
    if (Object.keys(set).length === 0) {
      throw new BadRequestException('Provide at least one field to update');
    }
    if (!isValidObjectId(seriesId)) {
      throw new NotFoundException('Series or episode not found');
    }

    let series: Series | null;
    try {
      series = await this.seriesModel
        .findOneAndUpdate(
          {
            _id: seriesId,
            episodes: { $elemMatch: { seasonNumber, episodeNumber } },
          },
          { $set: set },
          { new: true, runValidators: true },
        )
        .populate(ADMIN_CATEGORY_POPULATE);
    } catch (err) {
      throw this.mapWriteError(err);
    }

    if (!series) {
      throw new NotFoundException('Series or episode not found');
    }

    if (dto.title !== undefined) {
      await this.watchHistoryService.renameEpisodeEverywhere(
        String(seriesId),
        seasonNumber,
        episodeNumber,
        dto.title,
      );
    }
    return series;
  }

  // The history cleanup runs even when the episode is already gone, so
  // retrying a DELETE after a failed cleanup repairs it (spec 0004 AC-8).
  async deleteEpisode(
    seriesId: string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<Series> {
    if (!isValidObjectId(seriesId)) {
      throw new NotFoundException('Series or episode not found');
    }

    // Cloudflare videos go first (spec 0006 AC-13): if the delete below
    // fails, a retry still knows their ids.
    const current = await this.seriesModel
      .findOne(
        { _id: seriesId },
        { episodes: { $elemMatch: { seasonNumber, episodeNumber } } },
      )
      .lean<{ episodes?: Array<{ streamUid?: string | null; pendingStreamUid?: string | null }> }>();
    const target = current?.episodes?.[0];
    await this.streamClient.deleteVideo(target?.streamUid);
    await this.streamClient.deleteVideo(target?.pendingStreamUid);

    const series = await this.seriesModel
      .findOneAndUpdate(
        {
          _id: seriesId,
          episodes: { $elemMatch: { seasonNumber, episodeNumber } },
        },
        {
          $pull: { episodes: { seasonNumber, episodeNumber } },
          $inc: { totalEpisodes: -1 },
        },
        { new: true },
      )
      .populate(ADMIN_CATEGORY_POPULATE);

    await this.watchHistoryService.removeEpisodeEverywhere(
      String(seriesId),
      seasonNumber,
      episodeNumber,
    );
    // Best effort and retry safe too (spec 0005 AC-8).
    await this.mediaService.destroyByPrefix(
      this.mediaService.episodeThumbnailPrefix(
        String(seriesId),
        seasonNumber,
        episodeNumber,
      ),
    );

    if (!series) {
      throw new NotFoundException('Series or episode not found');
    }
    return series;
  }

  // isFree is computed over the full (season, episode) ordered list BEFORE
  // paginating, so page 2 still knows where the free teaser boundary is.
  // Viewers only see playable episodes, and total counts those (spec 0006).
  async getEpisodes(
    seriesId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    total: number;
    episodes: any[];
  }> {
    const series = await this.seriesModel
      .findById(seriesId)
      .select('episodes isPremium freeEpisodeCount')
      .lean();

    if (!series) {
      throw new NotFoundException('Series not found');
    }

    const skip = (page - 1) * limit;
    const visible = toPublicEpisodes(series as any, { playableOnly: true });

    return {
      total: visible.length,
      episodes: visible.slice(skip, skip + limit),
    };
  }

  async getPlayableEpisode(
    seriesId: string,
    seasonNumber: number,
    episodeNumber: number,
    user: any,
  ): Promise<PlayableEpisode> {
    if (!isValidObjectId(seriesId)) {
      throw new NotFoundException('Series not found');
    }

    const series = await this.seriesModel
      .findById(seriesId)
      .select('episodes isPremium freeEpisodeCount')
      .lean();

    if (!series) {
      throw new NotFoundException('Series not found');
    }

    const episode = sortEpisodes(series.episodes).find(
      (ep) =>
        ep.seasonNumber === seasonNumber && ep.episodeNumber === episodeNumber,
    );

    // An episode without a playable video doesn't exist for viewers
    // (spec 0006 AC-9), so this comes before the premium check.
    if (!episode || !isPlayable(episode)) {
      throw new NotFoundException('Episode not found');
    }

    const now = new Date();
    if (!canPlay(series, seasonNumber, episodeNumber, user, now)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: PREMIUM_REQUIRED,
        message: 'Premium subscription required',
      });
    }

    const base = {
      seriesId,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      duration: episode.duration,
    };

    if (!episode.streamUid) {
      // A pasted legacy link: unchanged and unprotected until moved.
      return {
        ...base,
        videoUrl: episode.videoUrl as string,
        type: 'direct',
        expiresAt: null,
      };
    }

    if (!this.streamClient.canPlay()) {
      throw new ServiceUnavailableException('Lecture vidéo indisponible');
    }
    const expiresAt = playbackExpiry(
      now,
      episode.streamDuration ?? 0,
      episode.duration,
    );
    const token = this.streamClient.signPlaybackToken(
      episode.streamUid,
      expiresAt,
    );
    return {
      ...base,
      videoUrl: this.streamClient.manifestUrl(token),
      type: 'hls',
      expiresAt,
    };
  }

  // Narrow alias of updateSeries (spec 0004 AC-3), keeping its spec 0002
  // contract: the empty body check comes first, before the id check.
  async updateAccess(
    seriesId: string,
    dto: UpdateSeriesAccessDto,
  ): Promise<Series> {
    if (dto.isPremium === undefined && dto.freeEpisodeCount === undefined) {
      throw new BadRequestException(
        'Provide isPremium and/or freeEpisodeCount',
      );
    }
    return this.updateSeries(seriesId, {
      isPremium: dto.isPremium,
      freeEpisodeCount: dto.freeEpisodeCount,
    });
  }

  // Same retry safe order as deleteEpisode (spec 0004 AC-7, AC-8).
  async deleteSeries(id: string): Promise<{ message: string }> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Series not found');
    }

    // Cloudflare videos go first (spec 0006 AC-13), so a retried delete
    // still knows them.
    const current = await this.seriesModel
      .findById(id)
      .select('episodes.streamUid episodes.pendingStreamUid')
      .lean<{ episodes?: Array<{ streamUid?: string | null; pendingStreamUid?: string | null }> }>();
    for (const ep of current?.episodes ?? []) {
      await this.streamClient.deleteVideo(ep.streamUid);
      await this.streamClient.deleteVideo(ep.pendingStreamUid);
    }

    const result = await this.seriesModel.findByIdAndDelete(id);
    await this.watchHistoryService.removeSeriesEverywhere(String(id));
    // One call removes cover, banner, and every thumbnail (spec 0005 AC-8).
    await this.mediaService.destroyByPrefix(
      this.mediaService.seriesFolder(String(id)),
    );

    if (!result) {
      throw new NotFoundException('Series not found');
    }

    return { message: 'Series deleted successfully' };
  }

  async getTrendingSeries(limit: number = 10): Promise<Series[]> {
    return await this.seriesModel
      .find()
      .select('-episodes')
      .populate(CATEGORY_POPULATE)
      .sort({ rating: -1, votes: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async rateSeries(seriesId: string, ratingValue: number): Promise<Series> {
    if (ratingValue < 0 || ratingValue > 10) {
      throw new BadRequestException('Rating must be between 0 and 10');
    }

    const series = await this.seriesModel.findById(seriesId);

    if (!series) {
      throw new NotFoundException('Series not found');
    }

    const totalRating = series.rating * series.votes + ratingValue;
    const newVotes = series.votes + 1;
    const newRating = totalRating / newVotes;

    series.rating = parseFloat(newRating.toFixed(1));
    series.votes = newVotes;

    await series.save();
    return this.findPopulated(series._id);
  }

  // Write paths re-read so the response carries populated categories: the
  // document returned by create()/save() only holds raw ObjectIds.
  private async findPopulated(id: unknown): Promise<Series> {
    const series = await this.seriesModel
      .findById(id)
      .populate(CATEGORY_POPULATE);
    if (!series) {
      throw new NotFoundException('Series not found');
    }
    return series;
  }

  // Admin write and read paths: every category, hidden ones included
  // (dashboard spec 0005). Viewer paths keep findPopulated.
  private async findAdminPopulated(id: unknown): Promise<Series> {
    const series = await this.seriesModel
      .findById(id)
      .populate(ADMIN_CATEGORY_POPULATE);
    if (!series) {
      throw new NotFoundException('Series not found');
    }
    return series;
  }

  // Bad input must never surface as a 500: title is the only unique key on
  // Series, and validation or cast errors from Mongoose are client errors.
  private mapWriteError(err: unknown): unknown {
    if ((err as { code?: number })?.code === 11000) {
      return new ConflictException('Series with this title already exists');
    }
    if (
      err instanceof MongooseError.ValidationError ||
      err instanceof MongooseError.CastError
    ) {
      return new BadRequestException(err.message);
    }
    return err;
  }

  // Duplicates are merged; every id must exist (hidden categories allowed).
  private async validateCategoryIds(ids: string[]): Promise<Types.ObjectId[]> {
    const unique = [...new Set(ids)];
    const found = await this.categoryModel
      .find({ _id: { $in: unique } }, { _id: 1 })
      .lean()
      .exec();
    const foundIds = new Set(found.map((c) => String(c._id)));
    const missing = unique.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown category ids: ${missing.join(', ')}`,
      );
    }
    return unique.map((id) => new Types.ObjectId(id));
  }
}
