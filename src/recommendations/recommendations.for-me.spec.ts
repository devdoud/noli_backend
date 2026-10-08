import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { RecommendationsService } from './recommendations.service';
import { Series } from '../series/schemas/series.schema';
import { Category } from '../categories/schemas/category.schema';
import { WatchHistory } from '../watch-history/schemas/watch-history.schema';
import { WatchHistoryService } from '../watch-history/watch-history.service';

// Regression (review of spec 0003, 2026-10-01): for-me returned [] when the
// history had nothing to match. The real WatchHistoryService runs here; only
// the two collections are stand ins.
describe('GET /recommendations/for-me sources (spec 0003 AC-8, AC-9)', () => {
  let service: RecommendationsService;
  let seriesModel: { find: jest.Mock };
  let historyModel: { findOne: jest.Mock };

  const drama = new Types.ObjectId();
  const watched = new Types.ObjectId().toString();
  const POPULAR = [{ title: 'Popular pick' }];
  const SAME_CATEGORY = [{ title: 'Another drama' }];

  // Every series query resolves through .exec(); the chain shape is shared.
  const chain = (result: unknown) => {
    const q: any = {};
    for (const m of ['select', 'populate', 'sort', 'limit', 'lean']) q[m] = () => q;
    q.exec = () => Promise.resolve(result);
    return q;
  };

  beforeEach(async () => {
    seriesModel = {
      find: jest.fn((filter: Record<string, unknown> = {}, projection?: unknown) => {
        if (projection) {
          // The read of the watched series' categories.
          const ids = (filter._id as { $in: string[] }).$in;
          return chain(ids.includes(watched) ? [{ _id: watched, categoryIds: [drama] }] : []);
        }
        if (filter.categoryIds) {
          // Like MongoDB: $in on an empty list matches nothing.
          const wanted = (filter.categoryIds as { $in: unknown[] }).$in;
          return chain(wanted.length > 0 ? SAME_CATEGORY : []);
        }
        return chain(POPULAR);
      }),
    };
    historyModel = { findOne: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RecommendationsService,
        WatchHistoryService,
        { provide: getModelToken(Series.name), useValue: seriesModel },
        { provide: getModelToken(Category.name), useValue: { findOne: jest.fn() } },
        { provide: getModelToken(WatchHistory.name), useValue: historyModel },
      ],
    }).compile();
    service = moduleRef.get(RecommendationsService);
  });

  // Shaped like a hydrated Mongoose document (toObject included).
  const history = (episodes: object[]) =>
    historyModel.findOne.mockResolvedValue({
      userId: 'u1',
      episodes,
      toObject: () => ({ userId: 'u1', episodes }),
    });

  it('counts finished episodes as tastes: a user who completed a drama gets other dramas', async () => {
    history([{ seriesId: watched, seasonNumber: 1, episodeNumber: 1, isCompleted: true, lastWatchedAt: new Date() }]);

    await expect(service.getRecommendations('u1', 10)).resolves.toEqual(SAME_CATEGORY);
  });

  it('falls back to popular when the history matches no category (watched series deleted)', async () => {
    history([{ seriesId: new Types.ObjectId().toString(), seasonNumber: 1, episodeNumber: 1, isCompleted: false, lastWatchedAt: new Date() }]);

    await expect(service.getRecommendations('u1', 10)).resolves.toEqual(POPULAR);
  });

  it('falls back to popular when there is no history at all', async () => {
    historyModel.findOne.mockResolvedValue(null);

    await expect(service.getRecommendations('u1', 10)).resolves.toEqual(POPULAR);
  });

  it('lets a real failure surface instead of hiding it behind popular series', async () => {
    historyModel.findOne.mockRejectedValue(new Error('database unreachable'));

    await expect(service.getRecommendations('u1', 10)).rejects.toThrow('database unreachable');
  });
});
