import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SeriesController } from './series.controller';
import { SeriesService } from './series.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadThrottlerGuard } from '../media/upload-throttler.guard';

// Spec 0004 over real HTTP: the global ValidationPipe (whitelist, transform)
// decides what reaches the service. The service is mocked; its rules have
// their own unit tests in series.service.spec.ts.
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.headers['x-test-role'];
    if (!role) throw new UnauthorizedException();
    req.user = { _id: 'u1', role };
    return true;
  }
}

const ID = '65a1b2c3d4e5f6a7b8c9d0e1';
const CAT = '65a1b2c3d4e5f6a7b8c9d0e2';
const stored = {
  _id: ID,
  title: 'S',
  categoryIds: [{ _id: CAT, name: 'Drame', slug: 'drame' }],
  episodes: [
    { seasonNumber: 1, episodeNumber: 1, title: 'E1', duration: 60, videoUrl: 'https://vid/e1.mp4' },
  ],
};

describe('Series and episode management over HTTP (spec 0004)', () => {
  let app: INestApplication;
  const service = {
    updateSeries: jest.fn().mockResolvedValue(stored),
    updateAccess: jest.fn().mockResolvedValue(stored),
    updateEpisode: jest.fn().mockResolvedValue(stored),
    deleteEpisode: jest.fn().mockResolvedValue(stored),
    addEpisode: jest.fn().mockResolvedValue(stored),
    deleteSeries: jest.fn().mockResolvedValue({ message: 'Series deleted successfully' }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SeriesController],
      providers: [{ provide: SeriesService, useValue: service }],
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

  beforeEach(() => jest.clearAllMocks());

  const http = () => request(app.getHttpServer());
  const admin = (r: request.Test) => r.set('x-test-role', 'admin');

  describe('PATCH /series/:id (AC-1, AC-2)', () => {
    it('passes editable fields, trims the title, and strips rating, votes, totalEpisodes and episodes', async () => {
      const res = await admin(http().patch(`/series/${ID}`)).send({
        title: '  Nouveau titre  ',
        description: 'Une description',
        status: 'completed',
        releaseYear: 2024,
        categoryIds: [CAT],
        rating: 10,
        votes: 500,
        totalEpisodes: 99,
        episodes: [],
      });

      expect(res.status).toBe(200);
      expect(service.updateSeries).toHaveBeenCalledWith(ID, {
        title: 'Nouveau titre',
        description: 'Une description',
        status: 'completed',
        releaseYear: 2024,
        categoryIds: [CAT],
      });
      expect(res.text).not.toContain('videoUrl');
      expect(res.body.series.categories).toEqual([
        { _id: CAT, name: 'Drame', slug: 'drame', isVisible: true },
      ]);
    });

    it('lets description, images and country be cleared with null', async () => {
      await admin(http().patch(`/series/${ID}`))
        .send({ description: null, coverImage: null, country: null })
        .expect(200);
      expect(service.updateSeries).toHaveBeenCalledWith(ID, {
        description: null,
        coverImage: null,
        country: null,
      });
    });

    it.each([
      ['a blank title', { title: '   ' }],
      ['a null title', { title: null }],
      ['an empty category list', { categoryIds: [] }],
      ['a category id that is not a Mongo id', { categoryIds: ['nope'] }],
      ['an unknown status', { status: 'paused' }],
      ['a release year before 1888', { releaseYear: 1700 }],
      ['a fractional release year', { releaseYear: 2020.5 }],
      ['a negative free episode count', { freeEpisodeCount: -1 }],
    ])('refuses %s with 400', async (_label, body) => {
      await admin(http().patch(`/series/${ID}`)).send(body).expect(400);
      expect(service.updateSeries).not.toHaveBeenCalled();
    });

    it('refuses a viewer with 403 (AC-9)', async () => {
      await http().patch(`/series/${ID}`).set('x-test-role', 'user').send({ title: 'x' }).expect(403);
      expect(service.updateSeries).not.toHaveBeenCalled();
    });
  });

  it('PATCH /series/:id/access refuses isPremium null with 400 (AC-3)', async () => {
    await admin(http().patch(`/series/${ID}/access`)).send({ isPremium: null }).expect(400);
    expect(service.updateAccess).not.toHaveBeenCalled();
  });

  describe('PATCH /series/:id/episodes/:s/:e (AC-4)', () => {
    it('trims the title and strips the frozen season, episode and views', async () => {
      await admin(http().patch(`/series/${ID}/episodes/1/2`))
        .send({ title: '  Épisode renommé  ', duration: 900, seasonNumber: 7, episodeNumber: 9, views: 999 })
        .expect(200);
      expect(service.updateEpisode).toHaveBeenCalledWith(ID, 1, 2, {
        title: 'Épisode renommé',
        duration: 900,
      });
    });

    it.each([
      ['a blank title', { title: '   ' }],
      ['a zero duration', { duration: 0 }],
      ['a fractional duration', { duration: 1.5 }],
      ['a release date that is not ISO', { releaseDate: 'demain' }],
    ])('refuses %s with 400', async (_label, body) => {
      await admin(http().patch(`/series/${ID}/episodes/1/2`)).send(body).expect(400);
      expect(service.updateEpisode).not.toHaveBeenCalled();
    });

    it('refuses a season that is not a whole number with 400 (AC-9)', async () => {
      await admin(http().patch(`/series/${ID}/episodes/x/1`)).send({ title: 'x' }).expect(400);
    });
  });

  describe('POST /series/:id/episodes (AC-10)', () => {
    const valid = { seasonNumber: 1, episodeNumber: 2, title: '  Pilote  ', duration: 1500 };

    it('accepts an ISO release date and trims the title', async () => {
      await admin(http().post(`/series/${ID}/episodes`))
        .send({ ...valid, releaseDate: '2026-01-20T00:00:00.000Z' })
        .expect(201);
      expect(service.addEpisode).toHaveBeenCalledWith(
        ID,
        expect.objectContaining({ title: 'Pilote', releaseDate: '2026-01-20T00:00:00.000Z' }),
      );
    });

    it.each([
      ['a fractional episode number', { ...valid, episodeNumber: 1.5 }],
      ['episode number 0', { ...valid, episodeNumber: 0 }],
      ['a blank title', { ...valid, title: '   ' }],
      ['a zero duration', { ...valid, duration: 0 }],
      ['a release date that is not ISO', { ...valid, releaseDate: '20/01/2026' }],
      ['a missing season', { episodeNumber: 2, title: 'x', duration: 60 }],
    ])('refuses %s with 400', async (_label, body) => {
      await admin(http().post(`/series/${ID}/episodes`)).send(body).expect(400);
      expect(service.addEpisode).not.toHaveBeenCalled();
    });
  });

  describe('deletes (AC-6, AC-7, AC-9)', () => {
    it('DELETE an episode answers with the series (admin shape, no videoUrl)', async () => {
      const res = await admin(http().delete(`/series/${ID}/episodes/1/1`)).expect(200);
      expect(service.deleteEpisode).toHaveBeenCalledWith(ID, 1, 1);
      expect(res.body.message).toBe('Episode deleted');
      expect(res.text).not.toContain('videoUrl');
    });

    it('DELETE a series as admin reaches the service; a viewer gets 403', async () => {
      await admin(http().delete(`/series/${ID}`)).expect(200);
      expect(service.deleteSeries).toHaveBeenCalledWith(ID);
      jest.clearAllMocks();
      await http().delete(`/series/${ID}`).set('x-test-role', 'user').expect(403);
      expect(service.deleteSeries).not.toHaveBeenCalled();
    });
  });
});
