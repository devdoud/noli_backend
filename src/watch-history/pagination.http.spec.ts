import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WatchHistoryController } from './watch-history.controller';
import { WatchHistoryService } from './watch-history.service';
import { RecommendationsController } from '../recommendations/recommendations.controller';
import { RecommendationsService } from '../recommendations/recommendations.service';

// Feature 16: query strings arrive as text. With the global ValidationPipe of
// main.ts, page and limit must be converted to numbers, not refused.
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest().user = { _id: { toString: () => 'u1' } };
    return true;
  }
}

describe('page and limit query parameters (feature 16)', () => {
  let app: INestApplication;
  const history = {
    getWatchHistory: jest.fn().mockResolvedValue({ total: 0, page: 1, limit: 10, history: {} }),
    getContinueWatching: jest.fn().mockResolvedValue({ episodes: [] }),
  };
  const recs = {
    getPopularSeries: jest.fn().mockResolvedValue([]),
    getTrendingNow: jest.fn().mockResolvedValue([]),
    getTopRatedSeries: jest.fn().mockResolvedValue([]),
    getNewSeries: jest.fn().mockResolvedValue([]),
    getPersonalizedRecommendations: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WatchHistoryController, RecommendationsController],
      providers: [
        { provide: WatchHistoryService, useValue: history },
        { provide: RecommendationsService, useValue: recs },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('GET /watch-history', () => {
    it('accepts numeric page and limit and passes them as numbers', async () => {
      await request(app.getHttpServer()).get('/watch-history?page=2&limit=50').expect(200);
      expect(history.getWatchHistory).toHaveBeenCalledWith('u1', 2, 50);
    });

    it('keeps the defaults (page 1, limit 10) without parameters', async () => {
      await request(app.getHttpServer()).get('/watch-history').expect(200);
      expect(history.getWatchHistory).toHaveBeenCalledWith('u1', 1, 10);
    });

    it.each(['page=abc', 'page=0', 'limit=0', 'limit=1.5', 'limit=51'])(
      'still refuses %s with 400',
      async (query) => {
        await request(app.getHttpServer()).get(`/watch-history?${query}`).expect(400);
        expect(history.getWatchHistory).not.toHaveBeenCalled();
      },
    );
  });

  describe('GET /watch-history/continue-watching', () => {
    it('passes limit as a number, default 5', async () => {
      await request(app.getHttpServer()).get('/watch-history/continue-watching?limit=3').expect(200);
      expect(history.getContinueWatching).toHaveBeenCalledWith('u1', 3);
      await request(app.getHttpServer()).get('/watch-history/continue-watching').expect(200);
      expect(history.getContinueWatching).toHaveBeenLastCalledWith('u1', 5);
    });

    it('refuses a non numeric limit with 400', async () => {
      await request(app.getHttpServer()).get('/watch-history/continue-watching?limit=abc').expect(400);
      expect(history.getContinueWatching).not.toHaveBeenCalled();
    });
  });

  describe('recommendations limit', () => {
    it.each(['popular', 'trending', 'top-rated', 'new'])(
      'GET /recommendations/%s?limit=5 passes 5 as a number',
      async (route) => {
        const res = await request(app.getHttpServer()).get(`/recommendations/${route}?limit=5`);
        expect(res.status).toBe(200);
        const called = Object.values(recs).find((fn) => fn.mock.calls.length > 0);
        expect(called?.mock.calls[0]).toContain(5);
      },
    );

    it('refuses limit=abc and limit=0 with 400', async () => {
      await request(app.getHttpServer()).get('/recommendations/popular?limit=abc').expect(400);
      await request(app.getHttpServer()).get('/recommendations/popular?limit=0').expect(400);
    });
  });
});
