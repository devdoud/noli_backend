import {
  adminVideoStatus,
  canPlay,
  hasPremiumAccess,
  isEpisodeFree,
  isPlayable,
  sortEpisodes,
  toAdminSeries,
  toPublicSeries,
  toPublicSeriesList,
} from './content-access';
import { BILLING_GRACE_PERIOD_MS } from '../billing/billing.constants';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-09-30T12:00:00.000Z');

// Deliberately out of order, two seasons, to catch episode-number-only sorting.
const episodes = [
  { seasonNumber: 2, episodeNumber: 1, title: 'S2E1', videoUrl: 'u21' },
  { seasonNumber: 1, episodeNumber: 2, title: 'S1E2', videoUrl: 'u12' },
  { seasonNumber: 1, episodeNumber: 1, title: 'S1E1', videoUrl: 'u11' },
];

const premiumSeries = { isPremium: true, freeEpisodeCount: 2, episodes };

const premiumUser = (endDate: Date | null) => ({
  role: 'user',
  subscription: { plan: 'premium', isActive: true, endDate },
});

describe('content-access', () => {
  describe('sortEpisodes', () => {
    it('orders by season then episode, without mutating the input', () => {
      const sorted = sortEpisodes(episodes);
      expect(sorted.map((e) => e.title)).toEqual(['S1E1', 'S1E2', 'S2E1']);
      expect(episodes[0].title).toBe('S2E1');
    });
  });

  describe('isEpisodeFree (AC-1, AC-2)', () => {
    it('treats every episode of a free series as free', () => {
      expect(isEpisodeFree({ isPremium: false, episodes }, 2, 1)).toBe(true);
    });

    it('treats a missing isPremium as free (pre backfill data)', () => {
      expect(isEpisodeFree({ episodes }, 2, 1)).toBe(true);
    });

    it('frees exactly the first N across seasons, in (season, episode) order', () => {
      expect(isEpisodeFree(premiumSeries, 1, 1)).toBe(true);
      expect(isEpisodeFree(premiumSeries, 1, 2)).toBe(true);
      expect(isEpisodeFree(premiumSeries, 2, 1)).toBe(false);
    });

    it('frees nothing when freeEpisodeCount is 0', () => {
      expect(
        isEpisodeFree({ ...premiumSeries, freeEpisodeCount: 0 }, 1, 1),
      ).toBe(false);
    });

    it('frees everything when freeEpisodeCount exceeds the episode count', () => {
      expect(
        isEpisodeFree({ ...premiumSeries, freeEpisodeCount: 99 }, 2, 1),
      ).toBe(true);
    });
  });

  describe('hasPremiumAccess (AC-3)', () => {
    it('grants access to an active premium user before endDate', () => {
      expect(
        hasPremiumAccess(premiumUser(new Date(now.getTime() + DAY)), now),
      ).toBe(true);
    });

    it('still grants access inside the grace window after endDate', () => {
      const endDate = new Date(
        now.getTime() - BILLING_GRACE_PERIOD_MS + 60_000,
      );
      expect(hasPremiumAccess(premiumUser(endDate), now)).toBe(true);
    });

    it('refuses once endDate plus grace has passed, even if isActive is still true', () => {
      expect(
        hasPremiumAccess(premiumUser(new Date(now.getTime() - 2 * DAY)), now),
      ).toBe(false);
    });

    it('fails closed when a premium subscription has no endDate', () => {
      expect(hasPremiumAccess(premiumUser(null), now)).toBe(false);
    });

    it('refuses free, inactive, and subscription-less users', () => {
      const future = new Date(now.getTime() + DAY);
      expect(
        hasPremiumAccess(
          { subscription: { plan: 'free', isActive: true, endDate: future } },
          now,
        ),
      ).toBe(false);
      expect(
        hasPremiumAccess(
          {
            subscription: { plan: 'premium', isActive: false, endDate: future },
          },
          now,
        ),
      ).toBe(false);
      expect(hasPremiumAccess({ role: 'user' }, now)).toBe(false);
    });

    it('always grants access to admins', () => {
      expect(hasPremiumAccess({ role: 'admin' }, now)).toBe(true);
    });
  });

  describe('canPlay', () => {
    it('lets a free user play a teaser but not a locked episode', () => {
      const freeUser = {
        role: 'user',
        subscription: { plan: 'free', isActive: true },
      };
      expect(canPlay(premiumSeries, 1, 1, freeUser, now)).toBe(true);
      expect(canPlay(premiumSeries, 2, 1, freeUser, now)).toBe(false);
    });

    it('lets a premium user play everything', () => {
      const user = premiumUser(new Date(now.getTime() + DAY));
      expect(canPlay(premiumSeries, 2, 1, user, now)).toBe(true);
    });
  });

  describe('toPublicSeries (AC-5, AC-6)', () => {
    it('strips videoUrl, sorts, and adds isFree on a plain object', () => {
      const result: any = toPublicSeries({
        _id: 's1',
        title: 'Show',
        ...premiumSeries,
      });
      expect(result.episodes.map((e: any) => [e.title, e.isFree])).toEqual([
        ['S1E1', true],
        ['S1E2', true],
        ['S2E1', false],
      ]);
      expect(JSON.stringify(result)).not.toContain('videoUrl');
    });

    it('converts a Mongoose-like document via toObject before mapping', () => {
      const doc = {
        videoUrl: 'should-not-matter',
        toObject: () => ({ title: 'Show', isPremium: false, episodes }),
      };
      const result: any = toPublicSeries(doc);
      expect(result.toObject).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('videoUrl');
      expect(result.episodes.every((e: any) => e.isFree)).toBe(true);
    });

    it('keeps a series without episodes as is, with an empty categories list', () => {
      expect(toPublicSeries({ _id: 's1', title: 'Show' })).toEqual({
        _id: 's1',
        title: 'Show',
        categories: [],
      });
    });
  });

  describe('toPublicSeries categories (spec 0003, AC-8)', () => {
    it('maps populated categories to { _id, name, slug } and drops categoryIds and genres', () => {
      const result = toPublicSeries({
        _id: 's1',
        genres: ['Drama'],
        categoryIds: [
          { _id: 'c1', name: 'Drame', slug: 'drame', isVisible: true },
        ],
      });

      expect(result).toEqual({
        _id: 's1',
        categories: [{ _id: 'c1', name: 'Drame', slug: 'drame' }],
      });
    });

    it('builds categories on list items, which have no episodes array', () => {
      const [item] = toPublicSeriesList([
        {
          _id: 's1',
          categoryIds: [{ _id: 'c1', name: 'Drame', slug: 'drame' }],
        },
      ]);

      expect(item.categories).toEqual([
        { _id: 'c1', name: 'Drame', slug: 'drame' },
      ]);
      expect(item).not.toHaveProperty('episodes');
    });

    it('never echoes a raw id from a path that forgot to populate', () => {
      const result = toPublicSeries({
        _id: 's1',
        categoryIds: ['64b000000000000000000001'],
      });

      expect(result.categories).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('64b000000000000000000001');
    });

    it('maps categories and episodes together on a hydrated document', () => {
      const result: any = toPublicSeries({
        toObject: () => ({
          isPremium: false,
          categoryIds: [{ _id: 'c1', name: 'Drame', slug: 'drame' }],
          episodes,
        }),
      });

      expect(result.categories).toHaveLength(1);
      expect(result.episodes).toHaveLength(3);
      expect(JSON.stringify(result)).not.toContain('videoUrl');
    });
  });

  describe('toAdminSeries categories (dashboard spec 0005)', () => {
    it('keeps hidden categories with their visibility flag', () => {
      const result = toAdminSeries({
        _id: 's1',
        categoryIds: [
          { _id: 'c1', name: 'Drame', slug: 'drame', isVisible: true },
          { _id: 'c2', name: 'Bientôt', slug: 'bientot', isVisible: false },
        ],
      });

      expect(result.categories).toEqual([
        { _id: 'c1', name: 'Drame', slug: 'drame', isVisible: true },
        { _id: 'c2', name: 'Bientôt', slug: 'bientot', isVisible: false },
      ]);
      expect(result).not.toHaveProperty('categoryIds');
    });

    it('treats a category populated without the flag as visible', () => {
      const result = toAdminSeries({
        _id: 's1',
        categoryIds: [{ _id: 'c1', name: 'Drame', slug: 'drame' }],
      });

      expect(result.categories).toEqual([
        { _id: 'c1', name: 'Drame', slug: 'drame', isVisible: true },
      ]);
    });

    it('never echoes a raw id from a path that forgot to populate', () => {
      const result = toAdminSeries({
        _id: 's1',
        categoryIds: ['64b000000000000000000001'],
      });

      expect(result.categories).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('64b000000000000000000001');
    });

    it('leaves the viewer shape without the visibility flag', () => {
      const result = toPublicSeries({
        _id: 's1',
        categoryIds: [
          { _id: 'c1', name: 'Drame', slug: 'drame', isVisible: true },
        ],
      });

      expect(result.categories).toEqual([
        { _id: 'c1', name: 'Drame', slug: 'drame' },
      ]);
    });
  });

  describe('playable episodes (spec 0006)', () => {
    // E1 still processing (no video yet), E2 on Cloudflare, E3 a pasted link.
    const mixed = {
      _id: 's1',
      isPremium: true,
      freeEpisodeCount: 1,
      totalEpisodes: 3,
      episodes: [
        { seasonNumber: 1, episodeNumber: 3, title: 'E3', videoUrl: 'https://old/e3.mp4' },
        {
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'E1',
          pendingStreamUid: 'p1',
          pendingStatus: 'processing',
        },
        { seasonNumber: 1, episodeNumber: 2, title: 'E2', streamUid: 'cf2', streamDuration: 1400 },
      ],
    };

    it('an episode plays from a Cloudflare video or a pasted link, nothing else (AC-9)', () => {
      expect(isPlayable({ streamUid: 'x' })).toBe(true);
      expect(isPlayable({ videoUrl: 'https://x' })).toBe(true);
      expect(isPlayable({ pendingStreamUid: 'p', pendingStatus: 'processing' })).toBe(false);
      expect(isPlayable({})).toBe(false);
    });

    it('computes the free teaser over playable episodes only (AC-9)', () => {
      expect(isEpisodeFree(mixed, 1, 1)).toBe(false);
      expect(isEpisodeFree(mixed, 1, 2)).toBe(true);
      expect(isEpisodeFree(mixed, 1, 3)).toBe(false);
    });

    it('an unplayable episode is never free, even in a free series', () => {
      expect(isEpisodeFree({ ...mixed, isPremium: false }, 1, 1)).toBe(false);
      expect(isEpisodeFree({ ...mixed, isPremium: false }, 1, 2)).toBe(true);
    });

    it('viewer shape: hides unplayable episodes, counts the playable ones, never leaks video fields (AC-9)', () => {
      const viewer = toPublicSeries(mixed, { playableOnly: true });

      expect((viewer.episodes as any[]).map((e) => [e.title, e.isFree])).toEqual([
        ['E2', true],
        ['E3', false],
      ]);
      expect(viewer.totalEpisodes).toBe(2);
      const json = JSON.stringify(viewer);
      for (const field of ['videoUrl', 'streamUid', 'pendingStreamUid', 'pendingStatus', 'streamDuration']) {
        expect(json).not.toContain(field);
      }
    });

    it('admin shape: keeps every episode with its video status (AC-10)', () => {
      const admin = toAdminSeries(mixed);
      const byTitle = Object.fromEntries((admin.episodes as any[]).map((e) => [e.title, e]));

      expect(admin.totalEpisodes).toBe(3);
      expect(byTitle.E1.video).toMatchObject({ status: 'pending', pendingStreamUid: 'p1' });
      expect(byTitle.E1.isFree).toBe(false);
      expect(byTitle.E2.video).toMatchObject({ status: 'ready', streamUid: 'cf2' });
      expect(byTitle.E3.video).toMatchObject({ status: 'legacy', hasPastedUrl: true });
      expect(JSON.stringify(admin)).not.toContain('https://old/e3.mp4');
    });

    it.each([
      ['a playing video wins over a failed replacement', { streamUid: 'a', pendingStreamUid: 'b', pendingStatus: 'error' }, 'ready'],
      ['a failed first upload', { pendingStreamUid: 'b', pendingStatus: 'error' }, 'error'],
      ['a pending first upload', { pendingStreamUid: 'b', pendingStatus: 'awaiting_upload' }, 'pending'],
      ['a pasted link only', { videoUrl: 'https://x' }, 'legacy'],
      ['nothing at all', {}, 'none'],
    ])('admin status for %s', (_label, fields, expected) => {
      expect(adminVideoStatus(fields).status).toBe(expected);
    });
  });
});
