import { BadRequestException } from '@nestjs/common';
import { validateImage } from './validate-image';

// image-size is mocked here so we can feed EXIF orientation directly.
jest.mock('image-size', () => ({
  __esModule: true,
  default: () => ({ width: 1500, height: 1000, orientation: 6 }),
}));

describe('validateImage EXIF orientation (spec 0005 AC-5)', () => {
  const jpeg = {
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]),
  } as Express.Multer.File;

  it('measures a quarter turned photo upright (orientation 6 swaps the sides)', () => {
    // Stored 1500 × 1000 landscape, really a 1000 × 1500 portrait: fits a cover.
    expect(() => validateImage(jpeg, 'seriesCover')).not.toThrow();
    // ...and is too narrow once upright for a banner (needs 1280 wide).
    expect(() => validateImage(jpeg, 'seriesBanner')).toThrow(
      BadRequestException,
    );
  });
});
