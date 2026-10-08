import {
  BadRequestException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import sizeOf from 'image-size';
import {
  IMAGE_SLOTS,
  ImageSlot,
  MAX_ASPECT_RATIO,
  MAX_IMAGE_PIXELS,
} from './image-slots';

type ImageKind = 'jpeg' | 'png' | 'webp';

// Checked on the file's own bytes, never on its name or declared type, and
// before anything reaches Cloudinary (spec 0005 AC-5). Multer has already
// refused anything over 5 MB with 413.
export function validateImage(
  file: Express.Multer.File | undefined,
  slot: ImageSlot,
): void {
  if (!file?.buffer?.length) {
    throw new BadRequestException('Fichier image manquant (champ "file")');
  }
  const buffer = file.buffer;

  const kind = detectKind(buffer);
  if (!kind) {
    throw new UnsupportedMediaTypeException(
      'Format non accepté : JPEG, PNG ou WebP uniquement',
    );
  }
  if (isAnimated(buffer, kind)) {
    throw new UnsupportedMediaTypeException('Images animées non acceptées');
  }

  let width: number | undefined;
  let height: number | undefined;
  let orientation: number | undefined;
  try {
    ({ width, height, orientation } = sizeOf(buffer));
  } catch {
    throw new BadRequestException('Image illisible');
  }
  if (!width || !height) {
    throw new BadRequestException('Image illisible');
  }
  // EXIF 5 to 8 means the picture is stored rotated a quarter turn;
  // Cloudinary rotates it upright, so measure it upright too.
  if (orientation !== undefined && orientation >= 5 && orientation <= 8) {
    [width, height] = [height, width];
  }

  const spec = IMAGE_SLOTS[slot];
  if (width < spec.minWidth || height < spec.minHeight) {
    throw new BadRequestException(
      `Image trop petite : au moins ${spec.minWidth} × ${spec.minHeight} px`,
    );
  }
  if (Math.max(width, height) > MAX_ASPECT_RATIO * Math.min(width, height)) {
    throw new BadRequestException(
      `Image trop étirée : le grand côté doit faire au plus ${MAX_ASPECT_RATIO} fois le petit`,
    );
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new BadRequestException('Image trop grande : 25 mégapixels au plus');
  }
}

function detectKind(buf: Buffer): ImageKind | null {
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return 'jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && png.every((b, i) => buf[i] === b)) {
    return 'png';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function isAnimated(buf: Buffer, kind: ImageKind): boolean {
  if (kind === 'png') {
    // An APNG declares acTL before its first IDAT chunk.
    let offset = 8;
    while (offset + 8 <= buf.length) {
      const length = buf.readUInt32BE(offset);
      const type = buf.toString('ascii', offset + 4, offset + 8);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      offset += 12 + length;
    }
    return false;
  }
  if (kind === 'webp') {
    // RIFF chunks after the 12 byte header; animated files carry ANIM/ANMF.
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const type = buf.toString('ascii', offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      if (type === 'ANIM' || type === 'ANMF') return true;
      offset += 8 + size + (size % 2);
    }
    return false;
  }
  return false;
}
