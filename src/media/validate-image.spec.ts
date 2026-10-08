import {
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { validateImage } from './validate-image';

// Builds tiny but valid headers: image-size only reads the header, so a PNG
// signature plus its IHDR chunk is a "real" image of any size we like.
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([
    len,
    Buffer.from(type, 'ascii'),
    data,
    Buffer.alloc(4),
  ]);
}

function png(width: number, height: number, extra: Buffer[] = []): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', Buffer.alloc(2)),
  ]);
}

function webp(chunks: Array<[string, Buffer]>): Buffer {
  const body = Buffer.concat(
    chunks.map(([type, data]) => {
      const size = Buffer.alloc(4);
      size.writeUInt32LE(data.length);
      return Buffer.concat([Buffer.from(type, 'ascii'), size, data]);
    }),
  );
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(4 + body.length);
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    riffSize,
    Buffer.from('WEBP', 'ascii'),
    body,
  ]);
}

const file = (buffer: Buffer) => ({ buffer }) as Express.Multer.File;

describe('validateImage (spec 0005 AC-5)', () => {
  it('accepts a PNG at the cover minimum', () => {
    expect(() =>
      validateImage(file(png(400, 600)), 'seriesCover'),
    ).not.toThrow();
  });

  it('refuses a missing file with 400', () => {
    expect(() => validateImage(undefined, 'seriesCover')).toThrow(
      BadRequestException,
    );
  });

  it('refuses a GIF (even renamed) and random bytes with 415', () => {
    expect(() =>
      validateImage(file(Buffer.from('GIF89a......')), 'seriesCover'),
    ).toThrow(UnsupportedMediaTypeException);
    expect(() =>
      validateImage(file(Buffer.from('MZ executable')), 'seriesCover'),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('refuses an animated PNG and an animated WebP with 415', () => {
    const apng = png(800, 800, [chunk('acTL', Buffer.alloc(8))]);
    expect(() => validateImage(file(apng), 'categoryImage')).toThrow(
      UnsupportedMediaTypeException,
    );
    const anim = webp([
      ['VP8X', Buffer.alloc(10)],
      ['ANIM', Buffer.alloc(6)],
    ]);
    expect(() => validateImage(file(anim), 'categoryImage')).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it('refuses an unreadable image with 400', () => {
    const broken = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2,
    ]);
    expect(() => validateImage(file(broken), 'seriesCover')).toThrow(
      BadRequestException,
    );
  });

  it('checks both sides against the slot minimum (a 400 × 50 cover fails)', () => {
    expect(() => validateImage(file(png(400, 50)), 'seriesCover')).toThrow(
      /au moins 400 × 600/,
    );
    expect(() => validateImage(file(png(399, 600)), 'seriesCover')).toThrow(
      BadRequestException,
    );
  });

  it('refuses a shape more stretched than 5:1', () => {
    expect(() => validateImage(file(png(6000, 1100)), 'seriesBanner')).toThrow(
      /étirée/,
    );
  });

  it('refuses more than 25 megapixels', () => {
    expect(() => validateImage(file(png(6000, 4500)), 'seriesBanner')).toThrow(
      /25 mégapixels/,
    );
  });
});
