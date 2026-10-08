// The single source for every image slot (spec 0005): crop shape, minimum
// source size, and the Cloudinary path each file lives under. Uploads,
// ownership checks, and cascade deletes all build their paths here, so a
// delete can never reach outside the owner's own folder.

export type ImageSlot =
  | 'seriesCover'
  | 'seriesBanner'
  | 'episodeThumbnail'
  | 'categoryImage'
  | 'userAvatar';

export interface SlotSpec {
  width: number;
  height: number;
  gravity: 'auto' | 'auto:face';
  minWidth: number;
  minHeight: number;
}

export const IMAGE_SLOTS: Record<ImageSlot, SlotSpec> = {
  seriesCover: {
    width: 1000,
    height: 1500,
    gravity: 'auto',
    minWidth: 400,
    minHeight: 600,
  },
  seriesBanner: {
    width: 1920,
    height: 1080,
    gravity: 'auto',
    minWidth: 1280,
    minHeight: 720,
  },
  episodeThumbnail: {
    width: 1280,
    height: 720,
    gravity: 'auto',
    minWidth: 640,
    minHeight: 360,
  },
  categoryImage: {
    width: 800,
    height: 800,
    gravity: 'auto',
    minWidth: 400,
    minHeight: 400,
  },
  userAvatar: {
    width: 400,
    height: 400,
    gravity: 'auto:face',
    minWidth: 200,
    minHeight: 200,
  },
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 25_000_000;
export const MAX_ASPECT_RATIO = 5;

export interface SlotOwner {
  seriesId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  categoryId?: string;
  userId?: string;
}

// NODE_ENV cleaned to [a-z0-9-], so it is always a safe path segment.
export function envSegment(nodeEnv: string | undefined): string {
  const cleaned = (nodeEnv ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return cleaned || 'development';
}

export function seriesFolder(env: string, seriesId: string): string {
  return `noli/${env}/series/${seriesId}/`;
}

export function categoryFolder(env: string, categoryId: string): string {
  return `noli/${env}/categories/${categoryId}/`;
}

// The trailing hyphen keeps s1e2- from matching s1e20-.
export function episodeThumbnailPrefix(
  env: string,
  seriesId: string,
  seasonNumber: number,
  episodeNumber: number,
): string {
  return `${seriesFolder(env, seriesId)}episodes/s${seasonNumber}e${episodeNumber}-`;
}

// The owner slot prefix: a new upload is this plus a random suffix, and an
// old file is deleted only when its public id starts with it.
export function slotPrefix(
  env: string,
  slot: ImageSlot,
  owner: SlotOwner,
): string {
  switch (slot) {
    case 'seriesCover':
      return `${seriesFolder(env, required(owner.seriesId))}cover-`;
    case 'seriesBanner':
      return `${seriesFolder(env, required(owner.seriesId))}banner-`;
    case 'episodeThumbnail':
      return episodeThumbnailPrefix(
        env,
        required(owner.seriesId),
        required(owner.seasonNumber),
        required(owner.episodeNumber),
      );
    case 'categoryImage':
      return `${categoryFolder(env, required(owner.categoryId))}image-`;
    case 'userAvatar':
      return `noli/${env}/users/${required(owner.userId)}/avatar-`;
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Missing image slot owner id');
  }
  return value;
}
