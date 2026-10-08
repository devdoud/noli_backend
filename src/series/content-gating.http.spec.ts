import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SeriesController } from './series.controller';
import { SeriesService } from './series.service';
import { Series } from './schemas/series.schema';
import { Category } from '../categories/schemas/category.schema';
import { WatchHistoryService } from '../watch-history/watch-history.service';
import { MediaService } from '../media/media.service';
import { StreamClient } from '../video/stream.client';
import { VideoStateService } from '../video/video-state.service';
import { NotificationQueue } from '../notifications/notification-queue';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadThrottlerGuard } from '../media/upload-throttler.guard';

// Spec 0002 over real HTTP: controller, global ValidationPipe, ParseIntPipe,
// the real SeriesService and access rules, and the response mapper. Only the
// database (the Mongoose model) and the JWT check are stand ins.
const DAY = 24 * 3600 * 1000;

const USERS: Record<string, object> = {
  free: { _id: 'u-free', role: 'user', subscription: { plan: 'free', isActive: true } },
  premium: {
    _id: 'u-prem',
    role: 'user',
    subscription: { plan: 'premium', isActive: true, endDate: new Date(Date.now() + 30 * DAY) },
  },
  lapsed: {
    _id: 'u-lapsed',
    role: 'user',
    subscription: { plan: 'premium', isActive: true, endDate: new Date(Date.now() - 2 * DAY) },
  },
  admin: { _id: 'u-admin', role: 'admin', subscription: { plan: 'free', isActive: true } },
};

class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const who = req.headers['x-test-user'];
    if (!who || !USERS[who]) throw new UnauthorizedException();
    req.user = USERS[who];
    return true;
  }
}

const P = '65a1b2c3d4e5f6a7b8c9d0e1';
// Added out of order on purpose: S2E1, S1E2, S1E1.
const premiumSeries = () => ({
  _id: P,
  title: 'P',
  isPremium: true,
  freeEpisodeCount: 2,
  categoryIds: [{ _id: 'c1', name: 'Drame', slug: 'drame' }],
  episodes: [
    { seasonNumber: 2, episodeNumber: 1, title: 'S2E1', duration: 60, videoUrl: 'https://vid/p21.mp4' },
    { seasonNumber: 1, episodeNumber: 2, title: 'S1E2', duration: 60, videoUrl: 'https://vid/p12.mp4' },
    { seasonNumber: 1, episodeNumber: 1, title: 'S1E1', duration: 60, videoUrl: 'https://vid/p11.mp4' },
  ],
});

describe('Content gating over HTTP (spec 0002)', () => {
  let app: INestApplication;
  let stored: ReturnType<typeof premiumSeries>;
  const model = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    exists: jest.fn(),
  };

  // findById(...).select(...).lean() for reads, findById(...).populate(...)
  // for the series detail; both resolve to the current stored series.
  const chain = () => {
    const q: any = {
      select: () => q,
      lean: () => Promise.resolve(stored),
      populate: () => Promise.resolve(stored),
      then: (res: any, rej: any) => Promise.resolve(stored).then(res, rej),
    };
    return q;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SeriesController],
      providers: [
        SeriesService,
        { provide: getModelToken(Series.name), useValue: model },
        { provide: getModelToken(Category.name), useValue: { find: jest.fn() } },
        { provide: WatchHistoryService, useValue: {} },
        { provide: MediaService, useValue: {} },
        { provide: StreamClient, useValue: { canPlay: () => false } },
        { provide: VideoStateService, useValue: {} },
        { provide: NotificationQueue, useValue: { episodePlayable: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .overrideGuard(UploadThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    stored = premiumSeries();
    model.findById.mockImplementation(() => chain());
  });

  const play = (s: number, e: number, who?: string) => {
    const req = request(app.getHttpServer()).get(`/series/${P}/episodes/${s}/${e}/play`);
    return who ? req.set('x-test-user', who) : req;
  };

  describe('GET .../play', () => {
    it('lets any signed in user play a free series (AC-1)', async () => {
      stored = { ...premiumSeries(), isPremium: false };
      const res = await play(2, 1, 'free').expect(200);
      expect(res.body.data).toMatchObject({ videoUrl: 'https://vid/p21.mp4', type: 'direct' });
    });

    it('frees the first freeEpisodeCount episodes in (season, episode) order for a free user (AC-2)', async () => {
      await play(1, 1, 'free').expect(200);
      const res = await play(1, 2, 'free').expect(200);
      expect(res.body.data.videoUrl).toBe('https://vid/p12.mp4');
    });

    it('locks the rest with the exact PREMIUM_REQUIRED body (AC-2)', async () => {
      const res = await play(2, 1, 'free').expect(403);
      expect(res.body).toEqual({
        statusCode: 403,
        code: 'PREMIUM_REQUIRED',
        message: 'Premium subscription required',
      });
    });

    it('opens every episode to an active premium user and an admin, and closes it after the grace period (AC-3)', async () => {
      await play(2, 1, 'premium').expect(200);
      await play(2, 1, 'admin').expect(200);
      await play(2, 1, 'lapsed').expect(403);
    });

    it('answers 401 without a token, 404 for a bad id or a missing episode, 400 for a non integer number (AC-4)', async () => {
      await play(1, 1).expect(401);
      await request(app.getHttpServer())
        .get('/series/not-an-id/episodes/1/1/play')
        .set('x-test-user', 'free')
        .expect(404);
      await play(9, 9, 'free').expect(404);
      await request(app.getHttpServer())
        .get(`/series/${P}/episodes/abc/1/play`)
        .set('x-test-user', 'free')
        .expect(400);
    });
  });

  describe('read routes never leak videoUrl (AC-5, AC-6)', () => {
    it('GET /series/:id: no videoUrl, flags present, episodes ordered with isFree', async () => {
      const res = await request(app.getHttpServer()).get(`/series/${P}`).expect(200);

      expect(res.text).not.toContain('videoUrl');
      expect(res.text).not.toContain('https://vid/');
      expect(res.body.series).toMatchObject({ isPremium: true, freeEpisodeCount: 2 });
      expect(
        res.body.series.episodes.map((e: any) => `S${e.seasonNumber}E${e.episodeNumber}:${e.isFree}`),
      ).toEqual(['S1E1:true', 'S1E2:true', 'S2E1:false']);
    });

    it('GET /series/:id/episodes paginates after computing isFree (page 3, limit 1 is the locked S2E1)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/series/${P}/episodes?page=3&limit=1`)
        .expect(200);

      expect(res.text).not.toContain('videoUrl');
      const episodes = res.body.data?.episodes ?? res.body.episodes;
      expect(episodes).toHaveLength(1);
      expect(episodes[0]).toMatchObject({ seasonNumber: 2, episodeNumber: 1, isFree: false });
    });
  });

  describe('PATCH /series/:id/access (AC-7)', () => {
    const patch = (body: object, who = 'admin') =>
      request(app.getHttpServer())
        .patch(`/series/${P}/access`)
        .set('x-test-user', who)
        .send(body);

    it('lets an admin change freeEpisodeCount, and the response leaks no videoUrl', async () => {
      model.findByIdAndUpdate.mockImplementation(() => ({
        populate: () => Promise.resolve({ ...premiumSeries(), freeEpisodeCount: 3 }),
      }));

      const res = await patch({ freeEpisodeCount: 3 }).expect(200);

      expect(res.body.series.freeEpisodeCount).toBe(3);
      expect(res.text).not.toContain('https://vid/');
      expect(model.findByIdAndUpdate.mock.calls[0][1]).toEqual({ $set: { freeEpisodeCount: 3 } });
    });

    it.each([
      ['an empty body', {}],
      ['a negative count', { freeEpisodeCount: -1 }],
      ['a fractional count', { freeEpisodeCount: 1.5 }],
      ['a null isPremium', { isPremium: null }],
    ])('refuses %s with 400 and writes nothing', async (_label, body) => {
      await patch(body).expect(400);
      expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('refuses a non admin with 403', async () => {
      await patch({ freeEpisodeCount: 1 }, 'premium').expect(403);
      expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
    });
  });
});
