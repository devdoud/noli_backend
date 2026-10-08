import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { RecommendationsService } from './recommendations.service';
import { Series } from '../series/schemas/series.schema';
import { Category } from '../categories/schemas/category.schema';
import { WatchHistoryService } from '../watch-history/watch-history.service';
import { CATEGORY_POPULATE } from '../series/content-access';

describe('RecommendationsService', () => {
  let service: RecommendationsService;
  let mockSeriesModel: any;
  let mockCategoryModel: any;
  let mockWatchHistoryService: any;

  const drama = new Types.ObjectId();
  const crime = new Types.ObjectId();
  const watchedA = new Types.ObjectId().toString();
  const watchedB = new Types.ObjectId().toString();

  // A returned list query: find().select().populate().sort().limit().lean().exec()
  function listChain(result: any[]) {
    return {
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
  }

  // An internal read: find()/findById()/findOne().lean().exec()
  function readChain(result: any) {
    return {
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
  }

  beforeEach(async () => {
    mockSeriesModel = { find: jest.fn(), findById: jest.fn() };
    mockCategoryModel = { findOne: jest.fn() };
    mockWatchHistoryService = { getWatchedSeriesIds: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationsService,
        { provide: getModelToken(Series.name), useValue: mockSeriesModel },
        { provide: getModelToken(Category.name), useValue: mockCategoryModel },
        { provide: WatchHistoryService, useValue: mockWatchHistoryService },
      ],
    }).compile();

    service = module.get<RecommendationsService>(RecommendationsService);
  });

  describe('getRecommendations (AC-9)', () => {
    it('matches on every category of the watched series and excludes them', async () => {
      // Unique ids come from the watch history; an invalid one is dropped.
      mockWatchHistoryService.getWatchedSeriesIds.mockResolvedValue([
        watchedA,
        watchedB,
        'not-an-id',
      ]);
      mockSeriesModel.find.mockReturnValueOnce(
        readChain([
          { _id: watchedA, categoryIds: [drama] },
          { _id: watchedB, categoryIds: [drama, crime] },
        ]),
      );
      const chain = listChain([{ title: 'True Detective' }]);
      mockSeriesModel.find.mockReturnValueOnce(chain);

      const result = await service.getRecommendations('user-1', 10);

      expect(result).toEqual([{ title: 'True Detective' }]);
      // invalid ids never reach a query, duplicates are merged
      expect(mockSeriesModel.find).toHaveBeenNthCalledWith(
        1,
        { _id: { $in: [watchedA, watchedB] } },
        { categoryIds: 1 },
      );
      const [filter] = mockSeriesModel.find.mock.calls[1];
      expect(filter._id).toEqual({ $nin: [watchedA, watchedB] });
      expect(filter.categoryIds.$in.map(String).sort()).toEqual(
        [String(drama), String(crime)].sort(),
      );
      expect(chain.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
      expect(chain.select).toHaveBeenCalledWith('-episodes');
    });

    it('falls back to popular series, still populated, when there is no history (AC-8)', async () => {
      mockWatchHistoryService.getWatchedSeriesIds.mockResolvedValue([]);
      const chain = listChain([{ title: 'Breaking Bad' }]);
      mockSeriesModel.find.mockReturnValue(chain);

      const result = await service.getRecommendations('new-user', 10);

      expect(result).toEqual([{ title: 'Breaking Bad' }]);
      expect(chain.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
    });
  });

  describe('getPopularSeries', () => {
    it('sorts by rating then votes, without episodes, with categories', async () => {
      const chain = listChain([{ title: 'Breaking Bad' }]);
      mockSeriesModel.find.mockReturnValue(chain);

      await service.getPopularSeries(10);

      expect(chain.sort).toHaveBeenCalledWith({ rating: -1, votes: -1 });
      expect(chain.select).toHaveBeenCalledWith('-episodes');
      expect(chain.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
    });
  });

  describe('getSimilarSeries (AC-9)', () => {
    it('matches on the source series categories', async () => {
      const sourceId = new Types.ObjectId().toString();
      mockSeriesModel.findById.mockReturnValue(
        readChain({ _id: sourceId, categoryIds: [drama] }),
      );
      const chain = listChain([{ title: 'Mindhunter' }]);
      mockSeriesModel.find.mockReturnValue(chain);

      await service.getSimilarSeries(sourceId, 5);

      expect(mockSeriesModel.find).toHaveBeenCalledWith({
        _id: { $ne: sourceId },
        categoryIds: { $in: [drama] },
      });
      expect(chain.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
    });

    it('throws NotFoundException if the series does not exist', async () => {
      mockSeriesModel.findById.mockReturnValue(readChain(null));

      await expect(service.getSimilarSeries('missing', 5)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getCategoryRecommendations (AC-9)', () => {
    it('returns the best rated series of a visible category', async () => {
      mockCategoryModel.findOne.mockReturnValue(readChain({ _id: drama }));
      const chain = listChain([{ title: 'The Crown' }]);
      mockSeriesModel.find.mockReturnValue(chain);

      await service.getCategoryRecommendations('drame', 10);

      expect(mockCategoryModel.findOne).toHaveBeenCalledWith(
        { slug: 'drame', isVisible: true },
        { _id: 1 },
      );
      expect(mockSeriesModel.find).toHaveBeenCalledWith({ categoryIds: drama });
      expect(chain.sort).toHaveBeenCalledWith({ rating: -1, votes: -1 });
    });

    it('returns 404 for an unknown or hidden category', async () => {
      mockCategoryModel.findOne.mockReturnValue(readChain(null));

      await expect(
        service.getCategoryRecommendations('secret', 10),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getNewSeries / getTopRatedSeries / getTrendingNow', () => {
    it.each([
      ['getNewSeries', { createdAt: -1 }],
      ['getTopRatedSeries', { rating: -1 }],
      ['getTrendingNow', { votes: -1, rating: -1 }],
    ] as const)(
      '%s sorts correctly and populates categories',
      async (method, sort) => {
        const chain = listChain([]);
        mockSeriesModel.find.mockReturnValue(chain);

        await service[method](10);

        expect(chain.sort).toHaveBeenCalledWith(sort);
        expect(chain.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
        expect(chain.select).toHaveBeenCalledWith('-episodes');
      },
    );
  });
});
