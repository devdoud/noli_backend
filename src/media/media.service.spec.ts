import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { MediaService } from './media.service';
import * as validation from './validate-image';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    url: jest.fn(
      (id: string, o: { version: number }) =>
        `https://res.cloudinary.com/noli-cloud/image/upload/f_auto,q_auto/v${o.version}/${id}`,
    ),
    uploader: { upload_stream: jest.fn(), destroy: jest.fn() },
    api: { delete_resources_by_prefix: jest.fn() },
  },
}));

const SERIES = '65a1b2c3d4e5f6a7b8c9d0e1';
const OTHER = '65a1b2c3d4e5f6a7b8c9d0e2';
const KEYS = {
  CLOUDINARY_CLOUD_NAME: 'noli-cloud',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
};

function makeService(env: Record<string, string | undefined>): MediaService {
  return new MediaService({ get: (k: string) => env[k] } as ConfigService);
}

const cdn = (publicId: string, cloud = 'noli-cloud') =>
  `https://res.cloudinary.com/${cloud}/image/upload/f_auto,q_auto/v123/${publicId}`;

// Makes the mocked upload_stream answer like Cloudinary does.
function uploadAnswers(error: unknown, result?: object) {
  (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
    (options: { public_id: string }, cb: (e: unknown, r?: object) => void) => ({
      end: () =>
        cb(
          error,
          error
            ? undefined
            : { public_id: options.public_id, version: 7, ...result },
        ),
    }),
  );
}

describe('MediaService (spec 0005)', () => {
  let service: MediaService;
  const file = { buffer: Buffer.from('img') } as Express.Multer.File;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(validation, 'validateImage').mockImplementation(() => undefined);
    service = makeService({ ...KEYS, NODE_ENV: 'development' });
  });

  afterEach(() => jest.restoreAllMocks());

  describe('environment and paths (AC-14)', () => {
    it('folders files by a cleaned NODE_ENV, development by default', () => {
      expect(makeService({ NODE_ENV: 'Prod/../x' }).env).toBe('prodx');
      expect(makeService({}).env).toBe('development');
      expect(service.slotPrefix('seriesCover', { seriesId: SERIES })).toBe(
        `noli/development/series/${SERIES}/cover-`,
      );
      expect(service.episodeThumbnailPrefix(SERIES, 1, 2)).toBe(
        `noli/development/series/${SERIES}/episodes/s1e2-`,
      );
    });
  });

  describe('ownedPublicId (AC-9, AC-14)', () => {
    const prefix = `noli/development/series/${SERIES}/cover-`;

    it('returns the id of a file this feature uploaded for this owner and slot', () => {
      expect(service.ownedPublicId(cdn(`${prefix}abc123`), prefix)).toBe(
        `${prefix}abc123`,
      );
    });

    it.each([
      ['a pasted URL', 'https://example.com/cover.jpg'],
      ['another cloud', cdn(`${prefix}abc`, 'someone-else')],
      ['another series', cdn(`noli/development/series/${OTHER}/cover-abc`)],
      ['the banner slot', cdn(`noli/development/series/${SERIES}/banner-abc`)],
      [
        'another environment',
        cdn(`noli/production/series/${SERIES}/cover-abc`),
      ],
      ['nothing', null],
    ])('returns null for %s', (_label, url) => {
      expect(service.ownedPublicId(url, prefix)).toBeNull();
    });

    // Regression (found by /check verify): the SDK appends ?_a=... to every
    // URL by default, and URLs already stored carry it.
    it('recognizes a stored URL that carries the SDK ?_a= query string', () => {
      expect(
        service.ownedPublicId(`${cdn(`${prefix}abc123`)}?_a=BAMAROWO0`, prefix),
      ).toBe(`${prefix}abc123`);
    });

    it('still recognizes an owned file when no keys are set', () => {
      const bare = makeService({ NODE_ENV: 'development' });
      expect(bare.ownedPublicId(cdn(`${prefix}abc`, 'any'), prefix)).toBe(
        `${prefix}abc`,
      );
    });
  });

  describe('replaceImage', () => {
    const base = () => ({
      file,
      slot: 'seriesCover' as const,
      owner: { seriesId: SERIES },
      currentUrl: null as string | null,
      save: jest.fn().mockResolvedValue({ saved: true }),
      exists: jest.fn().mockResolvedValue(true),
      notFoundMessage: 'Series not found',
    });

    it('uploads with the slot crop, saves the f_auto,q_auto URL, then deletes the owned old file (AC-1, AC-6)', async () => {
      uploadAnswers(null);
      const opts = {
        ...base(),
        currentUrl: cdn(`noli/development/series/${SERIES}/cover-old111`),
      };

      await expect(service.replaceImage(opts)).resolves.toEqual({
        saved: true,
      });

      const [options] = (cloudinary.uploader.upload_stream as jest.Mock).mock
        .calls[0];
      expect(options).toMatchObject({
        resource_type: 'image',
        overwrite: false,
        transformation: [
          { width: 1000, height: 1500, crop: 'fill', gravity: 'auto' },
        ],
      });
      expect(options.public_id).toMatch(
        new RegExp(`^noli/development/series/${SERIES}/cover-[a-f0-9]{12}$`),
      );
      expect(options).not.toHaveProperty('folder');
      const [oldUrl, newUrl] = opts.save.mock.calls[0];
      expect(oldUrl).toBe(opts.currentUrl);
      expect(newUrl).toContain('/f_auto,q_auto/v7/');
      expect(cloudinary.url).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ urlAnalytics: false }),
      );
      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
        `noli/development/series/${SERIES}/cover-old111`,
        { invalidate: true },
      );
    });

    it('never deletes a pasted URL it replaces', async () => {
      uploadAnswers(null);
      await service.replaceImage({
        ...base(),
        currentUrl: 'https://example.com/a.jpg',
      });
      expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
    });

    it('answers 200 even when deleting the old file fails (AC-6)', async () => {
      uploadAnswers(null);
      (cloudinary.uploader.destroy as jest.Mock).mockRejectedValue(
        new Error('down'),
      );
      await expect(
        service.replaceImage({
          ...base(),
          currentUrl: cdn(`noli/development/series/${SERIES}/cover-old`),
        }),
      ).resolves.toEqual({ saved: true });
    });

    it('a lost compare and set destroys the new file and answers 409, or 404 when the owner is gone (AC-13)', async () => {
      uploadAnswers(null);
      const opts = { ...base(), save: jest.fn().mockResolvedValue(null) };
      await expect(service.replaceImage(opts)).rejects.toThrow(
        ConflictException,
      );
      const newId = (cloudinary.uploader.upload_stream as jest.Mock).mock
        .calls[0][0].public_id;
      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(newId, {
        invalidate: true,
      });

      opts.exists.mockResolvedValue(false);
      await expect(service.replaceImage(opts)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('treats an error reported inside the upload result like a callback error (AC-5)', async () => {
      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (_o: unknown, cb: (e: unknown, r?: object) => void) => ({
          end: () => cb(undefined, { error: { http_code: 400, message: 'Invalid image file' } }),
        }),
      );
      const opts = base();
      await expect(service.replaceImage(opts)).rejects.toThrow(BadRequestException);
      expect(opts.save).not.toHaveBeenCalled();
    });

    it('a failing save destroys the new file and rethrows', async () => {
      uploadAnswers(null);
      const opts = {
        ...base(),
        save: jest.fn().mockRejectedValue(new Error('db')),
      };
      await expect(service.replaceImage(opts)).rejects.toThrow('db');
      expect(cloudinary.uploader.destroy).toHaveBeenCalledTimes(1);
    });

    it('maps a Cloudinary 400 to 400 and anything else to 503, saving nothing (AC-5, AC-12)', async () => {
      const opts = base();
      uploadAnswers({ http_code: 400, message: 'Invalid image file' });
      await expect(service.replaceImage(opts)).rejects.toThrow(
        BadRequestException,
      );
      uploadAnswers({ http_code: 499, message: 'timeout' });
      await expect(service.replaceImage(opts)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(opts.save).not.toHaveBeenCalled();
    });

    it('a refused file never reaches Cloudinary (AC-5)', async () => {
      jest.spyOn(validation, 'validateImage').mockImplementation(() => {
        throw new BadRequestException('too small');
      });
      await expect(service.replaceImage(base())).rejects.toThrow(
        BadRequestException,
      );
      expect(cloudinary.uploader.upload_stream).not.toHaveBeenCalled();
    });

    it('answers 503 without keys, before reading the file (AC-12)', async () => {
      const bare = makeService({});
      await expect(bare.replaceImage(base())).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(validation.validateImage).not.toHaveBeenCalled();
    });
  });

  describe('removeImage (AC-7, AC-12)', () => {
    const owned = cdn(`noli/development/series/${SERIES}/cover-old`);
    const base = (currentUrl: string | null) => ({
      slot: 'seriesCover' as const,
      owner: { seriesId: SERIES },
      current: { current: true },
      currentUrl,
      save: jest.fn().mockResolvedValue({ cleared: true }),
      exists: jest.fn().mockResolvedValue(true),
      notFoundMessage: 'Series not found',
    });

    it('an empty slot is a no op that returns the resource', async () => {
      const opts = base(null);
      await expect(service.removeImage(opts)).resolves.toEqual({
        current: true,
      });
      expect(opts.save).not.toHaveBeenCalled();
    });

    it('clears an uploaded file, then deletes it', async () => {
      const opts = base(owned);
      await expect(service.removeImage(opts)).resolves.toEqual({
        cleared: true,
      });
      expect(opts.save).toHaveBeenCalledWith(owned);
      expect(cloudinary.uploader.destroy).toHaveBeenCalledTimes(1);
    });

    it('clears a pasted URL without calling Cloudinary, even without keys', async () => {
      const bare = makeService({});
      const opts = base('https://example.com/a.jpg');
      await expect(bare.removeImage(opts)).resolves.toEqual({ cleared: true });
      expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
    });

    it('answers 503 without keys when an uploaded file would have to be deleted', async () => {
      const bare = makeService({});
      const opts = base(owned);
      await expect(bare.removeImage(opts)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(opts.save).not.toHaveBeenCalled();
    });

    it('a lost compare and set answers 409, or 404 when the owner is gone', async () => {
      const opts = { ...base(owned), save: jest.fn().mockResolvedValue(null) };
      await expect(service.removeImage(opts)).rejects.toThrow(
        ConflictException,
      );
      opts.exists.mockResolvedValue(false);
      await expect(service.removeImage(opts)).rejects.toThrow(
        NotFoundException,
      );
      expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
    });
  });

  describe('destroyIfOwned (AC-9)', () => {
    const owner = { seriesId: SERIES };

    it('deletes a file this feature uploaded for this owner and slot', async () => {
      await service.destroyIfOwned(
        `${cdn(`noli/development/series/${SERIES}/banner-abc`)}?_a=X`,
        'seriesBanner',
        owner,
      );
      expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
        `noli/development/series/${SERIES}/banner-abc`,
        { invalidate: true },
      );
    });

    it.each([
      ['a pasted URL', 'https://example.com/b.jpg'],
      ['the cover of the same series', cdn(`noli/development/series/${SERIES}/cover-abc`)],
      ['nothing', null],
    ])('never deletes %s', async (_label, url) => {
      await service.destroyIfOwned(url, 'seriesBanner', owner);
      expect(cloudinary.uploader.destroy).not.toHaveBeenCalled();
    });
  });

  describe('destroyByPrefix (AC-8)', () => {
    const del = cloudinary.api.delete_resources_by_prefix as jest.Mock;

    it('refuses a prefix outside an owner folder', async () => {
      await service.destroyByPrefix('noli/development/');
      await service.destroyByPrefix(`noli/development/series/not-an-id/`);
      expect(del).not.toHaveBeenCalled();
    });

    it('loops while Cloudinary answers partial, with CDN invalidation', async () => {
      del
        .mockResolvedValueOnce({ partial: true, next_cursor: 'c1' })
        .mockResolvedValueOnce({ partial: false });
      await service.destroyByPrefix(`noli/development/series/${SERIES}/`);
      expect(del).toHaveBeenCalledTimes(2);
      expect(del.mock.calls[1][1]).toEqual({
        invalidate: true,
        next_cursor: 'c1',
      });
    });

    it('never throws when Cloudinary fails', async () => {
      del.mockRejectedValue(new Error('rate limited'));
      await expect(
        service.destroyByPrefix(`noli/development/series/${SERIES}/`),
      ).resolves.toBeUndefined();
    });
  });
});
