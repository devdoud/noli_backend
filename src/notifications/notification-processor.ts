import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AnyBulkWriteOperation } from 'mongodb';
import { Model, Types } from 'mongoose';
import { Series } from '../series/schemas/series.schema';
import { WatchHistory } from '../watch-history/schemas/watch-history.schema';
import { User } from '../users/schemas/user.schema';
import { Category } from '../categories/schemas/category.schema';
import {
  hasPremiumAccess,
  isEpisodeFree,
  isPlayable,
} from '../series/content-access';
import { contentSendAfter, DAY_MS, lagosDay } from './lagos-time';
import { NotificationJob } from './schemas/notification-job.schema';
import { Notification, TYPE_RANK } from './schemas/notification.schema';
import { resolvePrefs } from './notifications.service';
import {
  MANY_EPISODES_SUFFIX,
  newEpisodeText,
  newSeriesText,
} from './templates/fr';

const JOBS_PER_RUN = 50;
const JOB_LOCK_MS = 5 * 60 * 1000;
const MAX_JOB_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const WRITE_BATCH = 500;
const RECENT_WATCH_MS = 90 * DAY_MS; // AC-4

type JobDoc = NotificationJob;

interface SeriesForJob {
  _id: Types.ObjectId;
  title: string;
  categoryIds: Types.ObjectId[];
  isPremium?: boolean;
  freeEpisodeCount?: number;
  announcedAt?: Date | null;
  episodes: {
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    videoUrl?: string | null;
    streamUid?: string | null;
  }[];
}

interface Recipient {
  _id: Types.ObjectId;
  role?: string;
  subscription?: User['subscription'];
  notificationPrefs?: User['notificationPrefs'];
}

// Raised when another worker took a job over (its lock went stale).
class LockLost extends Error {}

// Turns queued content events into per user notifications (spec 0008):
// preferences, access, recency, grouping, quiet hours. Pushing is the
// PushSender's job.
@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    @InjectModel(NotificationJob.name)
    private readonly jobModel: Model<NotificationJob>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @InjectModel(Series.name) private readonly seriesModel: Model<Series>,
    @InjectModel(WatchHistory.name)
    private readonly historyModel: Model<WatchHistory>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Category.name)
    private readonly categoryModel: Model<Category>,
  ) {}

  async processDueJobs(now: Date = new Date()): Promise<number> {
    let processed = 0;
    for (let i = 0; i < JOBS_PER_RUN; i++) {
      const job = await this.claim(now);
      if (!job) break;
      await this.run(job);
      processed++;
    }
    return processed;
  }

  private claim(now: Date): Promise<JobDoc | null> {
    return this.jobModel
      .findOneAndUpdate(
        {
          $or: [
            { status: 'pending', runAfter: { $lte: now } },
            {
              status: 'processing',
              lockedAt: { $lt: new Date(now.getTime() - JOB_LOCK_MS) },
            },
          ],
        },
        { $set: { status: 'processing', lockedAt: new Date() } },
        { sort: { runAfter: 1 }, returnDocument: 'after' },
      )
      .lean<JobDoc>();
  }

  // Public for tests: runs one claimed job to completion or reschedules it.
  async run(job: JobDoc): Promise<void> {
    const lock = { at: job.lockedAt! };
    try {
      await this.handleEpisodePlayable(job, lock);
      await this.jobModel.updateOne(
        { _id: job._id, lockedAt: lock.at },
        {
          $set: { status: 'done', lockedAt: null, finishedAt: new Date() },
        },
      );
    } catch (error) {
      if (error instanceof LockLost) {
        this.logger.warn(`Job ${job._id.toString()} taken over, stopping`);
        return;
      }
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.error(
        `Job ${job._id.toString()} failed (attempt ${attempts}): ${message}`,
      );
      const failed = attempts >= MAX_JOB_ATTEMPTS;
      await this.jobModel.updateOne(
        { _id: job._id, lockedAt: lock.at },
        {
          $set: {
            status: failed ? 'failed' : 'pending',
            attempts,
            error: message,
            lockedAt: null,
            runAfter: new Date(
              Date.now() +
                BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
            ),
            ...(failed ? { finishedAt: new Date() } : {}),
          },
        },
      );
    }
  }

  // Keeps a long fan out from looking stale to another worker.
  private async refreshLock(job: JobDoc, lock: { at: Date }): Promise<void> {
    const next = new Date();
    const res = await this.jobModel.updateOne(
      { _id: job._id, lockedAt: lock.at },
      { $set: { lockedAt: next } },
    );
    if (res.matchedCount === 0) throw new LockLost();
    lock.at = next;
  }

  private async handleEpisodePlayable(
    job: JobDoc,
    lock: { at: Date },
  ): Promise<void> {
    const { seriesId, seasonNumber, episodeNumber } = job.payload;
    const series = await this.seriesModel
      .findById(seriesId)
      .select(
        'title categoryIds isPremium freeEpisodeCount announcedAt episodes',
      )
      .lean<SeriesForJob>();
    const episode = series?.episodes.find(
      (ep) =>
        ep.seasonNumber === seasonNumber && ep.episodeNumber === episodeNumber,
    );
    if (!series || !episode || !isPlayable(episode)) return;

    // AC-5: the first playable episode of a series new since this feature
    // announces it, once. A missing announcedAt means an older series.
    let announcing = job.payload.announcing === true;
    if (!announcing) {
      const claimed = await this.seriesModel.updateOne(
        { _id: series._id, announcedAt: { $type: 'null' } },
        { $set: { announcedAt: new Date() } },
      );
      if (claimed.modifiedCount === 1) {
        await this.jobModel.updateOne(
          { _id: job._id },
          { $set: { 'payload.announcing': true } },
        );
        announcing = true;
      }
    }

    const free = isEpisodeFree(series, seasonNumber, episodeNumber);
    if (announcing) {
      await this.fanOutNewSeries(job, lock, series, episode, free);
      return;
    }

    // New episodes only for series announced before this event (or older
    // series): episodes made playable around the launch stay quiet.
    const fresh = await this.seriesModel
      .findById(series._id)
      .select('announcedAt')
      .lean<{ announcedAt?: Date | null }>();
    const announcedAt = fresh?.announcedAt;
    if (announcedAt === null) return;
    if (announcedAt && announcedAt.getTime() >= job.createdAt.getTime()) {
      return;
    }
    await this.fanOutNewEpisodes(job, lock, series, episode, free);
  }

  // Recipients filtered by preference and by whether they can play it.
  private async eligibleUsers(
    userIds: Types.ObjectId[],
    pref: 'newEpisodes' | 'newSeries',
    free: boolean,
  ): Promise<Recipient[]> {
    if (userIds.length === 0) return [];
    const now = new Date();
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('role subscription notificationPrefs')
      .lean<Recipient[]>();
    return users.filter(
      (u) =>
        resolvePrefs(u.notificationPrefs)[pref] &&
        (free ||
          hasPremiumAccess(
            { role: u.role, subscription: u.subscription },
            now,
          )),
    );
  }

  private async fanOutNewEpisodes(
    job: JobDoc,
    lock: { at: Date },
    series: SeriesForJob,
    episode: SeriesForJob['episodes'][number],
    free: boolean,
  ): Promise<void> {
    const since = new Date(Date.now() - RECENT_WATCH_MS);
    // watch_histories stores seriesId as a string and userId as an ObjectId.
    const watchers = await this.historyModel.aggregate<{
      userId: Types.ObjectId;
    }>([
      {
        $match: {
          episodes: {
            $elemMatch: {
              seriesId: series._id.toString(),
              lastWatchedAt: { $gte: since },
            },
          },
        },
      },
      { $group: { _id: '$userId' } },
      { $project: { _id: 0, userId: '$_id' } },
    ]);
    const recipients = await this.eligibleUsers(
      watchers.map((w) => new Types.ObjectId(String(w.userId))),
      'newEpisodes',
      free,
    );

    const now = new Date();
    const createdDay = lagosDay(job.createdAt);
    const sendAfter = contentSendAfter(now);
    const single = newEpisodeText(
      series.title,
      episode.seasonNumber,
      episode.episodeNumber,
      episode.title,
    );
    const ops = recipients.map((u): AnyBulkWriteOperation => ({
      updateOne: {
        filter: {
          userId: u._id,
          dedupeKey: `new_episodes:${series._id.toString()}:${createdDay}`,
        },
        // A pipeline update: applying the same job twice yields the same
        // document (AC-14); insert only fields use $ifNull.
        update: [
          {
            $set: {
              type: 'new_episodes',
              typeRank: TYPE_RANK.new_episodes,
              createdAt: { $ifNull: ['$createdAt', now] },
              pushStatus: { $ifNull: ['$pushStatus', 'pending'] },
              skipReason: { $ifNull: ['$skipReason', null] },
              sendAfter: { $ifNull: ['$sendAfter', sendAfter] },
              pushAttempts: { $ifNull: ['$pushAttempts', 0] },
              lockedAt: { $ifNull: ['$lockedAt', null] },
              jobIds: {
                $setUnion: [{ $ifNull: ['$jobIds', []] }, [job._id]],
              },
              title: { $literal: series.title },
              data: {
                seriesId: { $literal: series._id.toString() },
                seasonNumber: { $literal: episode.seasonNumber },
                episodeNumber: { $literal: episode.episodeNumber },
              },
              readAt: null,
              updatedAt: now,
            },
          },
          { $set: { 'data.count': { $size: '$jobIds' } } },
          {
            $set: {
              body: {
                $cond: [
                  { $eq: ['$data.count', 1] },
                  { $literal: single.body },
                  {
                    $concat: [
                      { $toString: '$data.count' },
                      { $literal: MANY_EPISODES_SUFFIX },
                    ],
                  },
                ],
              },
            },
          },
        ],
        upsert: true,
      },
    }));
    await this.writeInBatches(job, lock, ops, true);
    this.logger.log(
      `new_episodes for series ${series._id.toString()}: ${ops.length} recipient(s)`,
    );
  }

  private async fanOutNewSeries(
    job: JobDoc,
    lock: { at: Date },
    series: SeriesForJob,
    episode: SeriesForJob['episodes'][number],
    free: boolean,
  ): Promise<void> {
    const categoryIds = (series.categoryIds ?? []).map(
      (c) => new Types.ObjectId(String(c)),
    );
    if (categoryIds.length === 0) return;

    // Each user's top 3 categories by number of distinct watched series
    // (ties by category id), kept when they meet the new series' categories.
    const fans = await this.historyModel.aggregate<{
      _id: Types.ObjectId;
      top: Types.ObjectId[];
    }>([
      { $unwind: '$episodes' },
      { $group: { _id: { u: '$userId', s: '$episodes.seriesId' } } },
      {
        $addFields: {
          sid: {
            $convert: {
              input: '$_id.s',
              to: 'objectId',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      { $match: { sid: { $ne: null } } },
      {
        $lookup: {
          from: this.seriesModel.collection.name,
          localField: 'sid',
          foreignField: '_id',
          as: 's',
        },
      },
      { $unwind: '$s' },
      { $unwind: '$s.categoryIds' },
      { $group: { _id: { u: '$_id.u', c: '$s.categoryIds' }, n: { $sum: 1 } } },
      { $sort: { '_id.u': 1, n: -1, '_id.c': 1 } },
      { $group: { _id: '$_id.u', top: { $push: '$_id.c' } } },
      { $project: { top: { $slice: ['$top', 3] } } },
      { $match: { top: { $in: categoryIds } } },
    ]);
    const recipients = await this.eligibleUsers(
      fans.map((f) => new Types.ObjectId(String(f._id))),
      'newSeries',
      free,
    );
    const topByUser = new Map(
      fans.map((f) => [String(f._id), f.top.map(String)]),
    );
    const names = new Map(
      (
        await this.categoryModel
          .find({ _id: { $in: categoryIds } })
          .select('name')
          .lean<{ _id: Types.ObjectId; name: string }[]>()
      ).map((c) => [String(c._id), c.name]),
    );

    const now = new Date();
    const sendAfter = contentSendAfter(now);
    const seriesCats = new Set(categoryIds.map(String));
    const ops = recipients.map((u): AnyBulkWriteOperation => {
      const match =
        topByUser.get(String(u._id))?.find((c) => seriesCats.has(c)) ??
        String(categoryIds[0]);
      const text = newSeriesText(series.title, names.get(match) ?? 'Noli');
      return {
        updateOne: {
          filter: {
            userId: u._id,
            dedupeKey: `new_series:${series._id.toString()}`,
          },
          update: {
            $setOnInsert: {
              type: 'new_series',
              typeRank: TYPE_RANK.new_series,
              title: text.title,
              body: text.body,
              data: {
                seriesId: series._id.toString(),
                seasonNumber: episode.seasonNumber,
                episodeNumber: episode.episodeNumber,
              },
              jobIds: [job._id],
              pushStatus: 'pending',
              skipReason: null,
              sendAfter,
              pushAttempts: 0,
              lockedAt: null,
              readAt: null,
              createdAt: now,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      };
    });
    await this.writeInBatches(job, lock, ops, false);
    this.logger.log(
      `new_series for series ${series._id.toString()}: ${ops.length} recipient(s)`,
    );
  }

  // Unordered batches of 500, refreshing the job lock between them. Two
  // concurrent upserts on the same key make one fail with a duplicate key
  // error: retried once when it must apply (grouping), ignored otherwise.
  private async writeInBatches(
    job: JobDoc,
    lock: { at: Date },
    ops: AnyBulkWriteOperation[],
    retryDuplicates: boolean,
  ): Promise<void> {
    const collection = this.notificationModel.collection;
    for (let i = 0; i < ops.length; i += WRITE_BATCH) {
      const batch = ops.slice(i, i + WRITE_BATCH);
      try {
        await collection.bulkWrite(batch, { ordered: false });
      } catch (error) {
        const failed = duplicateIndexes(error);
        if (!failed) throw error;
        if (retryDuplicates && failed.length > 0) {
          await collection.bulkWrite(
            failed.map((idx) => batch[idx]),
            { ordered: false },
          );
        }
      }
      await this.refreshLock(job, lock);
    }
  }
}

// The indexes of the operations that failed only on a duplicate key, or null
// when the error is anything else.
function duplicateIndexes(error: unknown): number[] | null {
  const writeErrors = (
    error as { writeErrors?: { code?: number; index: number }[] }
  )?.writeErrors;
  if (!Array.isArray(writeErrors) || writeErrors.length === 0) return null;
  if (writeErrors.some((e) => e.code !== 11000)) return null;
  return writeErrors.map((e) => e.index);
}
