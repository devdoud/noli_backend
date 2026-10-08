import {
  IMAGE_SLOTS,
  categoryFolder,
  envSegment,
  episodeThumbnailPrefix,
  seriesFolder,
  slotPrefix,
} from './image-slots';

const SERIES = '65a1b2c3d4e5f6a7b8c9d0e1';
const CATEGORY = '65a1b2c3d4e5f6a7b8c9d0e2';
const USER = '65a1b2c3d4e5f6a7b8c9d0e3';

describe('image slots (spec 0005)', () => {
  describe('envSegment (AC-14)', () => {
    it.each([
      ['development', 'development'],
      ['Production', 'production'],
      ['staging-eu', 'staging-eu'],
      ['../prod/x', 'prodx'],
      ['', 'development'],
      [undefined, 'development'],
      ['///', 'development'],
    ])('turns NODE_ENV %p into the safe segment %p', (input, expected) => {
      expect(envSegment(input)).toBe(expected);
    });
  });

  describe('slotPrefix (AC-14)', () => {
    it('gives every slot its own folder and file name under noli/<env>/', () => {
      expect(slotPrefix('development', 'seriesCover', { seriesId: SERIES })).toBe(
        `noli/development/series/${SERIES}/cover-`,
      );
      expect(slotPrefix('development', 'seriesBanner', { seriesId: SERIES })).toBe(
        `noli/development/series/${SERIES}/banner-`,
      );
      expect(
        slotPrefix('development', 'episodeThumbnail', {
          seriesId: SERIES,
          seasonNumber: 2,
          episodeNumber: 10,
        }),
      ).toBe(`noli/development/series/${SERIES}/episodes/s2e10-`);
      expect(
        slotPrefix('development', 'categoryImage', { categoryId: CATEGORY }),
      ).toBe(`noli/development/categories/${CATEGORY}/image-`);
      expect(slotPrefix('development', 'userAvatar', { userId: USER })).toBe(
        `noli/development/users/${USER}/avatar-`,
      );
    });

    it('keeps episode 2 and episode 20 apart (the trailing hyphen)', () => {
      const e2 = episodeThumbnailPrefix('development', SERIES, 1, 2);
      const e20 = episodeThumbnailPrefix('development', SERIES, 1, 20);
      expect(`${e20}abc`.startsWith(e2)).toBe(false);
      expect(`${e2}abc`.startsWith(e20)).toBe(false);
    });

    it('keeps the cover and banner prefixes apart', () => {
      const cover = slotPrefix('development', 'seriesCover', { seriesId: SERIES });
      const banner = slotPrefix('development', 'seriesBanner', { seriesId: SERIES });
      expect(`${banner}abc`.startsWith(cover)).toBe(false);
    });

    it('places every slot of a series inside the series folder, so one prefix delete covers them all (AC-8)', () => {
      const folder = seriesFolder('development', SERIES);
      for (const slot of ['seriesCover', 'seriesBanner'] as const) {
        expect(slotPrefix('development', slot, { seriesId: SERIES }).startsWith(folder)).toBe(true);
      }
      expect(episodeThumbnailPrefix('development', SERIES, 1, 1).startsWith(folder)).toBe(true);
      expect(
        slotPrefix('development', 'categoryImage', { categoryId: CATEGORY }).startsWith(
          categoryFolder('development', CATEGORY),
        ),
      ).toBe(true);
    });

    it('refuses to build a path without the owner id', () => {
      expect(() => slotPrefix('development', 'seriesCover', {})).toThrow(
        'Missing image slot owner id',
      );
      expect(() =>
        slotPrefix('development', 'episodeThumbnail', { seriesId: SERIES }),
      ).toThrow('Missing image slot owner id');
    });
  });

  describe('IMAGE_SLOTS (AC-1 to AC-4)', () => {
    it.each([
      ['seriesCover', 1000, 1500, 400, 600],
      ['seriesBanner', 1920, 1080, 1280, 720],
      ['episodeThumbnail', 1280, 720, 640, 360],
      ['categoryImage', 800, 800, 400, 400],
      ['userAvatar', 400, 400, 200, 200],
    ] as const)(
      '%s crops to %i × %i and needs at least %i × %i',
      (slot, width, height, minWidth, minHeight) => {
        expect(IMAGE_SLOTS[slot]).toMatchObject({ width, height, minWidth, minHeight });
      },
    );

    it('centers avatars on the face and everything else on the most interesting area', () => {
      expect(IMAGE_SLOTS.userAvatar.gravity).toBe('auto:face');
      expect(IMAGE_SLOTS.seriesCover.gravity).toBe('auto');
    });
  });
});
