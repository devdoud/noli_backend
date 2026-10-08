import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { StreamClient } from './stream.client';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const FULL_ENV = {
  NODE_ENV: 'development',
  CLOUDFLARE_ACCOUNT_ID: 'acc123',
  CLOUDFLARE_STREAM_API_TOKEN: 'tok',
  CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc',
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: 'key1',
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: Buffer.from(privateKey).toString('base64'),
  CLOUDFLARE_STREAM_WEBHOOK_SECRET: 'whsec',
};

const make = (env: Record<string, string | undefined>) =>
  new StreamClient({ get: (k: string) => env[k] } as ConfigService);

const META = {
  name: 'S S1E1 Pilote',
  seriesId: 's1',
  seasonNumber: 1,
  episodeNumber: 1,
};

function respond(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    json: () => Promise.resolve(body),
  };
}

describe('StreamClient (spec 0006)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe('capabilities (AC-15)', () => {
    it('gates each feature on its own variables', () => {
      const full = make(FULL_ENV);
      expect([
        full.canManage(),
        full.canPlay(),
        full.canReceiveWebhooks(),
      ]).toEqual([true, true, true]);
      const playOnly = make({
        CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc',
        CLOUDFLARE_STREAM_SIGNING_KEY_ID: 'key1',
        CLOUDFLARE_STREAM_SIGNING_KEY_PEM:
          FULL_ENV.CLOUDFLARE_STREAM_SIGNING_KEY_PEM,
      });
      expect([
        playOnly.canManage(),
        playOnly.canPlay(),
        playOnly.canReceiveWebhooks(),
      ]).toEqual([false, true, false]);
    });

    it('answers 503 instead of calling Cloudflare without credentials', async () => {
      await expect(make({}).getVideo('x')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('createDirectUpload (AC-1, AC-8)', () => {
    it('asks for a signed, duration capped, expiring upload with the environment in meta', async () => {
      fetchMock.mockResolvedValue(
        respond(200, {
          success: true,
          result: { uid: 'u1', uploadURL: 'https://upload/u1' },
        }),
      );
      const expiry = new Date('2026-10-01T10:00:00.000Z');

      const res = await make(FULL_ENV).createDirectUpload({
        maxDurationSeconds: 10800,
        expiry,
        meta: META,
      });

      expect(res).toEqual({ uid: 'u1', uploadUrl: 'https://upload/u1' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://api.cloudflare.com/client/v4/accounts/acc123/stream/direct_upload',
      );
      expect(init.headers.Authorization).toBe('Bearer tok');
      expect(JSON.parse(init.body)).toEqual({
        maxDurationSeconds: 10800,
        expiry: '2026-10-01T10:00:00.000Z',
        requireSignedURLs: true,
        meta: { ...META, env: 'development' },
      });
    });

    it('turns a Cloudflare outage into 503', async () => {
      fetchMock.mockResolvedValue(respond(502, { success: false }));
      await expect(
        make(FULL_ENV).createDirectUpload({
          maxDurationSeconds: 1,
          expiry: new Date(),
          meta: META,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('createTusUpload (AC-1)', () => {
    it('sends tus headers with the case sensitive metadata keys and reads the uid', async () => {
      fetchMock
        .mockResolvedValueOnce(
          respond(
            201,
            {},
            {
              location:
                'https://upload.videodelivery.net/tus/uid999?tusv2=true',
            },
          ),
        )
        .mockResolvedValueOnce(respond(200, { success: true, result: {} }));

      const res = await make(FULL_ENV).createTusUpload({
        uploadLength: 900_000_000,
        maxDurationSeconds: 10800,
        expiry: new Date('2026-10-01T10:00:00.000Z'),
        meta: META,
      });

      expect(res).toEqual({
        uid: 'uid999',
        uploadUrl: 'https://upload.videodelivery.net/tus/uid999?tusv2=true',
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://api.cloudflare.com/client/v4/accounts/acc123/stream?direct_user=true',
      );
      expect(init.headers['Tus-Resumable']).toBe('1.0.0');
      expect(init.headers['Upload-Length']).toBe('900000000');
      const metadata: string = init.headers['Upload-Metadata'];
      expect(metadata).toContain(
        `maxDurationSeconds ${Buffer.from('10800').toString('base64')}`,
      );
      expect(metadata).toContain('requiresignedurls');
      expect(metadata).toContain(
        `expiry ${Buffer.from('2026-10-01T10:00:00.000Z').toString('base64')}`,
      );
      // The environment marker is set afterwards, since tus has no meta field.
      const [metaUrl, metaInit] = fetchMock.mock.calls[1];
      expect(metaUrl).toContain('/stream/uid999');
      expect(JSON.parse(metaInit.body).meta.env).toBe('development');
    });

    it('prefers the stream-media-id header when Cloudflare sends it', async () => {
      fetchMock
        .mockResolvedValueOnce(
          respond(
            201,
            {},
            { location: 'https://upload/x/y', 'stream-media-id': 'real-uid' },
          ),
        )
        .mockResolvedValueOnce(respond(200, { success: true, result: {} }));
      const res = await make(FULL_ENV).createTusUpload({
        uploadLength: 300_000_000,
        maxDurationSeconds: 10800,
        expiry: new Date(),
        meta: META,
      });
      expect(res.uid).toBe('real-uid');
    });
  });

  describe('copyFromUrl (AC-2)', () => {
    it('imports with signed playback required', async () => {
      fetchMock.mockResolvedValue(
        respond(200, { success: true, result: { uid: 'c1' } }),
      );
      await expect(
        make(FULL_ENV).copyFromUrl({ url: 'https://cdn/x.mp4', meta: META }),
      ).resolves.toEqual({ uid: 'c1' });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        url: 'https://cdn/x.mp4',
        requireSignedURLs: true,
      });
    });

    it('maps a link Cloudflare refuses to 400', async () => {
      fetchMock.mockResolvedValue(
        respond(400, {
          success: false,
          errors: [{ message: 'URL not reachable' }],
        }),
      );
      await expect(
        make(FULL_ENV).copyFromUrl({ url: 'https://cdn/x.mp4', meta: META }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteVideo (AC-12, AC-13)', () => {
    it('treats 404 as already deleted and never throws', async () => {
      fetchMock.mockResolvedValueOnce(respond(404, { success: false }));
      await expect(make(FULL_ENV).deleteVideo('gone')).resolves.toBeUndefined();
      fetchMock.mockRejectedValueOnce(new Error('network down'));
      await expect(make(FULL_ENV).deleteVideo('x')).resolves.toBeUndefined();
    });

    it('does nothing for an empty uid', async () => {
      await make(FULL_ENV).deleteVideo(null);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('signed playback (AC-7, AC-8)', () => {
    it('signs an RS256 token Cloudflare can verify with the key id, video uid, and expiry', () => {
      const client = make(FULL_ENV);
      const expiresAt = new Date(Date.now() + 3 * 3600 * 1000);

      const token = client.signPlaybackToken('vid42', expiresAt);
      const decoded = jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        complete: true,
      });

      expect(decoded.header.kid).toBe('key1');
      expect(decoded.payload).toMatchObject({
        sub: 'vid42',
        kid: 'key1',
        exp: Math.floor(expiresAt.getTime() / 1000),
      });
      expect((decoded.payload as jwt.JwtPayload).iat).toBeUndefined();
      expect(client.manifestUrl(token)).toBe(
        `https://customer-abc.cloudflarestream.com/${token}/manifest/video.m3u8`,
      );
    });

    it('answers 503 when the signing key is missing', () => {
      expect(() =>
        make({
          ...FULL_ENV,
          CLOUDFLARE_STREAM_SIGNING_KEY_PEM: undefined,
        }).signPlaybackToken('v', new Date()),
      ).toThrow(ServiceUnavailableException);
    });
  });
});
