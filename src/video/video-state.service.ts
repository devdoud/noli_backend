import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Series } from '../series/schemas/series.schema';
import { StreamClient, StreamVideo } from './stream.client';
import { NotificationQueue } from '../notifications/notification-queue';

export type TransitionOutcome =
  'applied' | 'repeat' | 'unknown' | 'ignored' | 'unchanged';

const UNKNOWN_RETRIES = 3;
const UNKNOWN_RETRY_DELAY_MS = 2_000;

interface EpisodeVideoRow {
  seasonNumber: number;
  episodeNumber: number;
  duration?: number;
  streamUid?: string | null;
  videoUrl?: string | null;
  pendingStreamUid?: string | null;
  pendingStatus?: string | null;
  pendingExpiresAt?: Date | null;
}

// Moves an episode's pending video forward from Cloudflare's reported state
// (spec 0006). Shared by the webhook and the admin refresh, and idempotent:
// every write is keyed by the uid, so a repeated or late delivery can only
// match an episode still waiting for exactly that video.
@Injectable()
export class VideoStateService {
  private readonly logger = new Logger(VideoStateService.name);

  constructor(
    @InjectModel(Series.name) private readonly seriesModel: Model<Series>,
    private readonly stream: StreamClient,
    private readonly notificationQueue: NotificationQueue,
  ) {}

  async applyStreamState(
    video: StreamVideo,
    options: { retryUnknown?: boolean } = {},
  ): Promise<TransitionOutcome> {
    const uid = video.uid;
    const env = video.meta?.env;
    if (typeof env === 'string' && env !== this.stream.env) {
      return 'ignored';
    }

    const attempts = options.retryUnknown ? UNKNOWN_RETRIES + 1 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const outcome = await this.applyOnce(uid, video);
      if (outcome !== 'unknown') {
        return outcome;
      }
      if (attempt < attempts) {
        // The write that saves a new pending uid may still be in flight
        // (a fast import can be ready within seconds).
        await new Promise((r) => setTimeout(r, UNKNOWN_RETRY_DELAY_MS));
      }
    }
    this.logger.warn(
      `Stream event for unknown video ${uid} (state ${video.status?.state})`,
    );
    return 'unknown';
  }

  // Unused upload links die (spec 0006 AC-16). Called by the admin view and
  // refresh; returns true when something changed.
  async expireUnusedUpload(
    seriesId: string,
    episode: EpisodeVideoRow,
    now: Date = new Date(),
  ): Promise<boolean> {
    const uid = episode.pendingStreamUid;
    if (
      !uid ||
      episode.pendingStatus !== 'awaiting_upload' ||
      !episode.pendingExpiresAt ||
      new Date(episode.pendingExpiresAt).getTime() > now.getTime()
    ) {
      return false;
    }
    const res = await this.seriesModel.updateOne(
      { _id: seriesId },
      {
        $set: {
          'episodes.$[e].pendingStatus': 'error',
          'episodes.$[e].pendingError': 'upload_expired',
          'episodes.$[e].pendingExpiresAt': null,
        },
      },
      {
        arrayFilters: [
          { 'e.pendingStreamUid': uid, 'e.pendingStatus': 'awaiting_upload' },
        ],
      },
    );
    if (res.modifiedCount > 0) {
      await this.stream.deleteVideo(uid);
      return true;
    }
    return false;
  }

  private async applyOnce(
    uid: string,
    video: StreamVideo,
  ): Promise<TransitionOutcome> {
    const state = video.status?.state;
    const holder = await this.seriesModel
      .findOne({ 'episodes.pendingStreamUid': uid })
      .select('episodes')
      .lean<{ _id: Types.ObjectId; episodes: EpisodeVideoRow[] }>();

    if (!holder) {
      const alreadyPlaying = await this.seriesModel.exists({
        'episodes.streamUid': uid,
      });
      return alreadyPlaying ? 'repeat' : 'unknown';
    }
    const episode = holder.episodes.find((ep) => ep.pendingStreamUid === uid);
    if (!episode) {
      return 'unknown';
    }
    const filter = { _id: holder._id, 'episodes.pendingStreamUid': uid };
    const arrayFilters = [{ 'e.pendingStreamUid': uid }];

    if (state === 'ready') {
      const reported = Math.round(video.duration ?? 0);
      const streamDuration =
        reported > 0 ? reported : (episode.duration ?? null);
      // One atomic write keyed by the uid; the pre image tells which video
      // it replaced.
      const before = await this.seriesModel
        .findOneAndUpdate(
          filter,
          {
            $set: {
              'episodes.$[e].streamUid': uid,
              'episodes.$[e].streamDuration': streamDuration,
              'episodes.$[e].pendingStreamUid': null,
              'episodes.$[e].pendingStatus': null,
              'episodes.$[e].pendingError': null,
              'episodes.$[e].pendingExpiresAt': null,
              'episodes.$[e].videoUrl': null,
            },
          },
          { arrayFilters, returnDocument: 'before' },
        )
        .select('episodes')
        .lean<{ episodes: EpisodeVideoRow[] }>();
      if (!before) {
        // Replaced or removed between the read and the write.
        return 'unchanged';
      }
      const previous = before.episodes.find(
        (ep) => ep.pendingStreamUid === uid,
      );
      if (previous?.streamUid && previous.streamUid !== uid) {
        await this.stream.deleteVideo(previous.streamUid);
      }
      // Spec 0008: only an episode that was not playable before is news; a
      // replacement video notifies no one.
      if (previous && !previous.streamUid && !previous.videoUrl) {
        await this.notificationQueue.episodePlayable(
          holder._id,
          episode.seasonNumber,
          episode.episodeNumber,
        );
      }
      return 'applied';
    }

    if (state === 'error') {
      const code = video.status?.errorReasonCode ?? 'unknown';
      const text = video.status?.errorReasonText;
      const res = await this.seriesModel.updateOne(
        filter,
        {
          $set: {
            'episodes.$[e].pendingStatus': 'error',
            'episodes.$[e].pendingError': text ? `${code}: ${text}` : code,
            'episodes.$[e].pendingExpiresAt': null,
          },
        },
        { arrayFilters },
      );
      return res.modifiedCount > 0 ? 'applied' : 'unchanged';
    }

    if (
      state === 'downloading' ||
      state === 'queued' ||
      state === 'inprogress'
    ) {
      if (episode.pendingStatus === 'processing') {
        return 'unchanged';
      }
      const res = await this.seriesModel.updateOne(
        filter,
        {
          $set: {
            'episodes.$[e].pendingStatus': 'processing',
            'episodes.$[e].pendingExpiresAt': null,
          },
        },
        { arrayFilters },
      );
      return res.modifiedCount > 0 ? 'applied' : 'unchanged';
    }

    // pendingupload (still waiting for the file), live states: nothing to do.
    return 'unchanged';
  }
}
