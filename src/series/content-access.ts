import { BILLING_GRACE_PERIOD_MS } from '../billing/billing.constants';

export const PREMIUM_REQUIRED = 'PREMIUM_REQUIRED';

interface EpisodeKey {
  seasonNumber: number;
  episodeNumber: number;
}

// The video fields of an episode (spec 0006). All optional: lean reads skip
// defaults, so episodes saved before spec 0006 simply lack them.
export interface EpisodeVideoFields {
  videoUrl?: string | null;
  streamUid?: string | null;
  pendingStreamUid?: string | null;
  pendingStatus?: string | null;
  pendingError?: string | null;
  pendingExpiresAt?: Date | string | null;
  streamDuration?: number | null;
}

// Internal fields never returned as is: the admin view exposes them through
// its `video` object, and videoUrl only ever leaves through /play.
const VIDEO_FIELDS = [
  'videoUrl',
  'streamUid',
  'pendingStreamUid',
  'pendingStatus',
  'pendingError',
  'pendingExpiresAt',
  'streamDuration',
] as const;
type VideoField = (typeof VIDEO_FIELDS)[number];

interface SeriesAccessFields<T extends EpisodeKey = EpisodeKey> {
  isPremium?: boolean;
  freeEpisodeCount?: number;
  episodes?: T[];
}

interface UserLike {
  role?: string;
  subscription?: {
    plan?: string;
    isActive?: boolean;
    endDate?: Date | string | null;
  };
}

export function sortEpisodes<T extends EpisodeKey>(episodes: T[]): T[] {
  return [...episodes].sort(
    (a, b) =>
      a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber,
  );
}

// An episode plays from its Cloudflare video, else from a pasted link, else
// not at all (spec 0006 AC-9).
export function isPlayable(ep: EpisodeVideoFields): boolean {
  return Boolean(ep.streamUid || ep.videoUrl);
}

// Episodes viewers can see, in (season, episode) order: the base of every
// teaser computation (spec 0006 AC-9).
export function playableInOrder<T extends EpisodeKey & EpisodeVideoFields>(
  episodes: T[] | undefined,
): T[] {
  return sortEpisodes((episodes ?? []).filter(isPlayable));
}

// Position based: whether an episode is free is never stored, so adding or
// reordering episodes can't leave a stale flag. A missing isPremium counts as
// free, matching the backfill of pre existing series. Only playable episodes
// count (spec 0006), so one still processing never takes a free slot, and an
// unplayable episode is never free.
export function isEpisodeFree(
  series: SeriesAccessFields<EpisodeKey & EpisodeVideoFields>,
  seasonNumber: number,
  episodeNumber: number,
): boolean {
  const index = playableInOrder(series.episodes).findIndex(
    (ep) =>
      ep.seasonNumber === seasonNumber && ep.episodeNumber === episodeNumber,
  );
  if (index === -1) {
    return false;
  }
  return !series.isPremium || index < (series.freeEpisodeCount ?? 0);
}

// Checked live instead of trusting isActive alone, so access ends at the
// moment endDate plus grace passes, not at the next midnight cron run. A
// premium subscription with no endDate grants nothing (fail closed).
export function hasPremiumAccess(user: UserLike, now: Date): boolean {
  if (user.role === 'admin') {
    return true;
  }
  const sub = user.subscription;
  if (sub?.plan !== 'premium' || sub?.isActive !== true || !sub?.endDate) {
    return false;
  }
  return (
    new Date(sub.endDate).getTime() + BILLING_GRACE_PERIOD_MS > now.getTime()
  );
}

export function canPlay(
  series: SeriesAccessFields<EpisodeKey & EpisodeVideoFields>,
  seasonNumber: number,
  episodeNumber: number,
  user: UserLike,
  now: Date,
): boolean {
  return (
    isEpisodeFree(series, seasonNumber, episodeNumber) ||
    hasPremiumAccess(user, now)
  );
}

export interface EpisodeListOptions {
  // Viewer routes leave unplayable episodes out entirely (spec 0006 AC-9).
  // Admin shapes keep every episode.
  playableOnly?: boolean;
}

export function toPublicEpisodes<
  T extends EpisodeKey & EpisodeVideoFields & { thumbnail?: string | null },
>(
  series: SeriesAccessFields<T>,
  options: EpisodeListOptions = {},
): Array<
  Omit<T, VideoField | 'thumbnail'> & {
    thumbnail: string | null;
    isFree: boolean;
  }
> {
  const all = sortEpisodes(series.episodes ?? []);
  const playable = all.filter(isPlayable);
  const shown = options.playableOnly ? playable : all;
  const freeCount = series.freeEpisodeCount ?? 0;
  return shown.map((ep) => {
    const playableIndex = playable.indexOf(ep);
    return {
      ...stripVideoFields(ep),
      // Lean reads skip defaults, so episodes saved before spec 0005 have no
      // thumbnail at all; the app always gets null instead of a missing key.
      thumbnail: ep.thumbnail ?? null,
      isFree:
        playableIndex !== -1 &&
        (!series.isPremium || playableIndex < freeCount),
    };
  });
}

function stripVideoFields<T extends object>(
  ep: T,
): Omit<T, VideoField | 'thumbnail'> {
  const copy = { ...ep } as Record<string, unknown>;
  for (const field of VIDEO_FIELDS) delete copy[field];
  delete copy.thumbnail;
  return copy as Omit<T, VideoField | 'thumbnail'>;
}

export type EpisodeVideoStatus =
  'ready' | 'pending' | 'error' | 'legacy' | 'none';

export interface AdminEpisodeVideo {
  status: EpisodeVideoStatus;
  streamUid: string | null;
  pendingStreamUid: string | null;
  pendingStatus: string | null;
  pendingError: string | null;
  pendingExpiresAt: Date | string | null;
  hasPastedUrl: boolean;
}

// The admin view of an episode's video (spec 0006 AC-10). A playing
// Cloudflare video wins: a pending or failed replacement shows through
// pendingStatus, not through status.
export function adminVideoStatus(ep: EpisodeVideoFields): AdminEpisodeVideo {
  let status: EpisodeVideoStatus;
  if (ep.streamUid) status = 'ready';
  else if (ep.pendingStatus === 'error') status = 'error';
  else if (ep.pendingStreamUid) status = 'pending';
  else if (ep.videoUrl) status = 'legacy';
  else status = 'none';
  return {
    status,
    streamUid: ep.streamUid ?? null,
    pendingStreamUid: ep.pendingStreamUid ?? null,
    pendingStatus: ep.pendingStatus ?? null,
    pendingError: ep.pendingError ?? null,
    pendingExpiresAt: ep.pendingExpiresAt ?? null,
    hasPastedUrl: Boolean(ep.videoUrl),
  };
}

// Every client facing series query adds this. On an array path, populate with
// `match` removes hidden and missing categories from the array (no nulls), so
// hidden category names never reach a series card.
export const CATEGORY_POPULATE = {
  path: 'categoryIds',
  select: 'name slug',
  match: { isVisible: true },
};

export interface PublicCategoryRef {
  _id: unknown;
  name: string;
  slug: string;
}

export type PublicSeries = Record<string, unknown> & {
  categories: PublicCategoryRef[];
};

function toPublicCategories(categoryIds: unknown): PublicCategoryRef[] {
  if (!Array.isArray(categoryIds)) {
    return [];
  }
  // Only populated objects with a name survive; a raw ObjectId (a path that
  // forgot to populate) is dropped rather than echoed back as an id.
  return categoryIds
    .filter(
      (c): c is PublicCategoryRef =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as PublicCategoryRef).name === 'string',
    )
    .map(({ _id, name, slug }) => ({ _id, name, slug }));
}

// Every series response, single or list, goes through here: the play endpoint
// stays the only place a videoUrl is returned, and categories replace the raw
// categoryIds (and any legacy genres). A hydrated document is converted first:
// its subdocuments serialize via toJSON and would keep videoUrl otherwise.
// Viewer routes that return episodes pass playableOnly (spec 0006 AC-9), which
// also makes totalEpisodes the playable count.
export function toPublicSeries(
  series: unknown,
  options: EpisodeListOptions = {},
): PublicSeries {
  const plain = toPlain(series);

  // Categories first: list responses have no episodes array, so this step must
  // not sit behind the episodes branch below.
  const { categoryIds, genres: _genres, ...rest } = plain;
  void _genres;
  const result: PublicSeries = {
    ...rest,
    categories: toPublicCategories(categoryIds),
  };

  if (Array.isArray(plain.episodes)) {
    const episodes = toPublicEpisodes(plain, options);
    result.episodes = episodes;
    if (options.playableOnly) {
      result.totalEpisodes = episodes.length;
    }
  }
  return result;
}

export function toPublicSeriesList(list: unknown[]): PublicSeries[] {
  return list.map((series) => toPublicSeries(series));
}

// The admin shape (spec 0006 AC-10): every episode, playable or not, each
// with its video status. Used by GET /series/:id/admin and every admin write
// on episodes, so a new episode without a video still shows up.
export function toAdminSeries(series: unknown): PublicSeries {
  const plain = toPlain(series);
  const result = toPublicSeries(plain);
  if (Array.isArray(plain.episodes)) {
    const byKey = new Map(
      plain.episodes.map((ep) => [
        `${ep.seasonNumber}:${ep.episodeNumber}`,
        ep,
      ]),
    );
    result.episodes = (result.episodes as EpisodeKey[]).map((ep) => ({
      ...ep,
      video: adminVideoStatus(
        byKey.get(`${ep.seasonNumber}:${ep.episodeNumber}`) ?? {},
      ),
    }));
  }
  return result;
}

function toPlain(series: unknown) {
  const maybeDoc = series as { toObject?: () => unknown };
  return (
    typeof maybeDoc?.toObject === 'function' ? maybeDoc.toObject() : series
  ) as SeriesAccessFields<EpisodeKey & EpisodeVideoFields> &
    Record<string, unknown>;
}
