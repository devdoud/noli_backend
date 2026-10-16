import type { PipelineStage } from 'mongoose';
import type { EpisodeVideoStatus } from './content-access';

// adminVideoStatus (content-access.ts) written as MongoDB expressions, for the
// dashboard overview counts and the "videos to process" filter (dashboard
// spec 0010). Same order, same truthiness: any change to adminVideoStatus must
// land here too; video-status-query.mongo.spec.ts checks both agree.

type Expr = Record<string, unknown>;

/** True only for a value that is neither missing, null nor an empty string. */
export function present(path: string): Expr {
  return { $ne: [{ $ifNull: [path, ''] }, ''] };
}

/** The status of one episode, `e` being its path ('$episodes' or '$$e'). */
export function videoStatusSwitch(e: string): Expr {
  return {
    $switch: {
      branches: [
        { case: present(`${e}.streamUid`), then: 'ready' },
        { case: { $eq: [`${e}.pendingStatus`, 'error'] }, then: 'error' },
        { case: present(`${e}.pendingStreamUid`), then: 'pending' },
        { case: present(`${e}.videoUrl`), then: 'legacy' },
      ],
      default: 'none',
    },
  };
}

/** True when the episode's video is not ready (anything but 'ready'). */
export function notReady(e: string): Expr {
  return { $not: [present(`${e}.streamUid`)] };
}

/** Query filter: the series has at least one episode whose video is not ready. */
export const notReadyMatch = {
  $elemMatch: { $or: [{ streamUid: null }, { streamUid: '' }] },
};

export const TO_PROCESS_STATUSES = [
  'none',
  'error',
  'pending',
  'legacy',
] as const satisfies readonly EpisodeVideoStatus[];

export interface VideosToProcess {
  total: number;
  none: number;
  error: number;
  pending: number;
  legacy: number;
}

export interface SeriesStats {
  series: number;
  episodes: number;
  videosToProcess: VideosToProcess;
}

/** One $group over every episode: the episode count and one count per status. */
export function seriesStatsPipeline(): PipelineStage[] {
  const perStatus = Object.fromEntries(
    TO_PROCESS_STATUSES.map((status) => [
      status,
      { $sum: { $cond: [{ $eq: ['$status', status] }, 1, 0] } },
    ]),
  );
  return [
    { $unwind: { path: '$episodes', preserveNullAndEmptyArrays: false } },
    { $project: { status: videoStatusSwitch('$episodes') } },
    { $group: { _id: null, episodes: { $sum: 1 }, ...perStatus } },
  ];
}

/** Per series of a page: how many of its episodes are not ready. */
export function videosToProcessPipeline(ids: unknown[]): PipelineStage[] {
  return [
    { $match: { _id: { $in: ids } } },
    {
      $project: {
        videosToProcess: {
          $size: {
            $filter: {
              input: { $ifNull: ['$episodes', []] },
              as: 'e',
              cond: notReady('$$e'),
            },
          },
        },
      },
    },
  ];
}
