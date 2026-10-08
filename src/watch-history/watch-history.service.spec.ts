import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { WatchHistoryService } from './watch-history.service';
import { WatchHistory } from './schemas/watch-history.schema';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('WatchHistoryService', () => {
  let service: WatchHistoryService;
  let mockWatchHistoryModel: any;

  beforeEach(async () => {
    // Créer le faux Model
    mockWatchHistoryModel = {
      findOne: jest.fn(),
      create: jest.fn(),
      deleteOne: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    // Créer le module de test
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WatchHistoryService,
        {
          provide: getModelToken(WatchHistory.name),
          useValue: mockWatchHistoryModel,
        },
      ],
    }).compile();

    service = module.get<WatchHistoryService>(WatchHistoryService);
  });

  // Les tests vont ici!
  describe('addToWatchHistory', () => {
    it('should create a new watch history for first episode', async () => {
      // ARRANGE
      const userId = 'user-123';
      const addToWatchHistoryDto: any = {
        seriesId: 'series-1',
        episodeNumber: 1,
        seasonNumber: 1,
        title: 'Episode 1',
        progressPercentage: 50,
      };

      const mockCreatedHistory: any = {
        userId,
        episodes: [
          {
            ...addToWatchHistoryDto,
            watchedAt: new Date(),
            lastWatchedAt: new Date(),
            isCompleted: false,
          },
        ],
        save: jest.fn().mockResolvedValue(this),
      };

      // Mock: historique n'existe pas
      mockWatchHistoryModel.findOne.mockResolvedValue(null);
      // Mock: créer l'historique
      mockWatchHistoryModel.create.mockResolvedValue(mockCreatedHistory);

      // ACT
      const result = await service.addToWatchHistory(
        userId,
        addToWatchHistoryDto,
      );

      // ASSERT
      expect(result).toEqual(mockCreatedHistory);
      expect(mockWatchHistoryModel.findOne).toHaveBeenCalledWith({ userId });
      expect(mockWatchHistoryModel.create).toHaveBeenCalled();
    });

    it('should add new episode to existing watch history', async () => {
      // ARRANGE
      const userId = 'user-123';
      const addToWatchHistoryDto: any = {
        seriesId: 'series-1',
        episodeNumber: 2,
        seasonNumber: 1,
        title: 'Episode 2',
        progressPercentage: 0,
      };

      const mockHistory: any = {
        userId,
        episodes: [
          {
            seriesId: 'series-1',
            episodeNumber: 1,
            seasonNumber: 1,
            title: 'Episode 1',
            progressPercentage: 100,
            isCompleted: true,
          },
        ],
        save: jest.fn().mockResolvedValue(this),
      };

      // Mock: historique existe
      mockWatchHistoryModel.findOne.mockResolvedValue(mockHistory);

      // ACT
      const result = await service.addToWatchHistory(
        userId,
        addToWatchHistoryDto,
      );

      // ASSERT
      expect(mockHistory.episodes.length).toBe(2);
      expect(mockHistory.save).toHaveBeenCalled();
    });

    it('should update existing episode in watch history', async () => {
      // ARRANGE
      const userId = 'user-123';
      const addToWatchHistoryDto: any = {
        seriesId: 'series-1',
        episodeNumber: 1,
        seasonNumber: 1,
        title: 'Episode 1 Updated',
        progressPercentage: 75,
      };

      const mockHistory: any = {
        userId,
        episodes: [
          {
            seriesId: 'series-1',
            episodeNumber: 1,
            seasonNumber: 1,
            title: 'Episode 1',
            progressPercentage: 50,
            isCompleted: false,
            lastWatchedAt: new Date(Date.now() - 86400000),
          },
        ],
        save: jest.fn().mockResolvedValue(this),
      };

      mockWatchHistoryModel.findOne.mockResolvedValue(mockHistory);

      // ACT
      const result = await service.addToWatchHistory(
        userId,
        addToWatchHistoryDto,
      );

      // ASSERT
      expect(mockHistory.episodes[0].progressPercentage).toBe(75);
      expect(mockHistory.save).toHaveBeenCalled();
    });
  });

  describe('getWatchHistory', () => {
    it('should return watch history with pagination', async () => {
      // ARRANGE
      const userId = 'user-123';
      const mockHistory: any = {
        userId,
        episodes: [
          { seriesId: 'series-1', episodeNumber: 1, lastWatchedAt: new Date() },
          {
            seriesId: 'series-2',
            episodeNumber: 2,
            lastWatchedAt: new Date(Date.now() - 1000),
          },
        ],
        toObject: jest.fn().mockReturnValue({
          userId,
          episodes: [
            {
              seriesId: 'series-1',
              episodeNumber: 1,
              lastWatchedAt: new Date(),
            },
          ],
        }),
      };

      mockWatchHistoryModel.findOne.mockResolvedValue(mockHistory);

      // ACT
      const result = await service.getWatchHistory(userId, 1, 10);

      // ASSERT
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('should throw NotFoundException if history not found', async () => {
      const userId = 'nonexistent-user';
      mockWatchHistoryModel.findOne.mockResolvedValue(null);

      await expect(service.getWatchHistory(userId, 1, 10)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getContinueWatching', () => {
    it('should return incomplete episodes', async () => {
      // ARRANGE
      const userId = 'user-123';
      const mockHistory: any = {
        userId,
        episodes: [
          {
            seriesId: 'series-1',
            episodeNumber: 1,
            isCompleted: false,
            lastWatchedAt: new Date(),
          },
          {
            seriesId: 'series-2',
            episodeNumber: 2,
            isCompleted: true,
            lastWatchedAt: new Date(),
          },
        ],
        toObject: jest.fn().mockReturnValue({
          userId,
          episodes: [
            { seriesId: 'series-1', episodeNumber: 1, isCompleted: false },
          ],
        }),
      };

      mockWatchHistoryModel.findOne.mockResolvedValue(mockHistory);

      // ACT
      const result = await service.getContinueWatching(userId, 5);

      // ASSERT
      expect(result.episodes.length).toBe(1);
      expect(result.episodes[0].isCompleted).toBe(false);
    });
  });

  describe('updateProgress', () => {
    it('should update episode progress', async () => {
      // ARRANGE
      const userId = 'user-123';
      const mockHistory: any = {
        userId,
        episodes: [
          {
            seriesId: 'series-1',
            episodeNumber: 1,
            seasonNumber: 1,
            progressPercentage: 50,
            isCompleted: false,
          },
        ],
        save: jest.fn().mockResolvedValue(this),
      };

      mockWatchHistoryModel.findOne.mockResolvedValue(mockHistory);

      // ACT
      const result = await service.updateProgress(
        userId,
        'series-1',
        1,
        1,
        100,
      );

      // ASSERT
      expect(mockHistory.episodes[0].progressPercentage).toBe(100);
      expect(mockHistory.episodes[0].isCompleted).toBe(true);
      expect(mockHistory.save).toHaveBeenCalled();
    });

    it('should throw error if progress is invalid', async () => {
      const userId = 'user-123';

      await expect(
        service.updateProgress(userId, 'series-1', 1, 1, 150),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.updateProgress(userId, 'series-1', 1, 1, -10),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeFromHistory', () => {
    it('should remove episode from history', async () => {
      // ARRANGE
      const userId = 'user-123';
      const mockHistory: any = {
        userId,
        episodes: [
          { seriesId: 'series-1', episodeNumber: 1, seasonNumber: 1 },
          { seriesId: 'series-1', episodeNumber: 2, seasonNumber: 1 },
        ],
        save: jest.fn().mockResolvedValue(this),
      };

      mockWatchHistoryModel.findOne.mockResolvedValue(mockHistory);

      // ACT
      const result = await service.removeFromHistory(userId, 'series-1', 1, 1);

      // ASSERT
      expect(mockHistory.episodes.length).toBe(1);
      expect(mockHistory.save).toHaveBeenCalled();
    });
  });

  describe('clearWatchHistory', () => {
    it('should delete entire watch history', async () => {
      const userId = 'user-123';
      mockWatchHistoryModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

      await service.clearWatchHistory(userId);

      expect(mockWatchHistoryModel.deleteOne).toHaveBeenCalledWith({ userId });
    });
  });
  describe('catalog cascades (spec 0004)', () => {
    it('removes one episode from every history, filtering on the indexed seriesId, without touching updatedAt', async () => {
      await service.removeEpisodeEverywhere('s1', 1, 2);

      expect(mockWatchHistoryModel.updateMany).toHaveBeenCalledWith(
        { 'episodes.seriesId': 's1' },
        {
          $pull: {
            episodes: { seriesId: 's1', seasonNumber: 1, episodeNumber: 2 },
          },
        },
        { timestamps: false },
      );
    });

    it('removes every episode of a series from every history', async () => {
      await service.removeSeriesEverywhere('s1');

      expect(mockWatchHistoryModel.updateMany).toHaveBeenCalledWith(
        { 'episodes.seriesId': 's1' },
        { $pull: { episodes: { seriesId: 's1' } } },
        { timestamps: false },
      );
    });

    it('renames only the matching episode entries', async () => {
      await service.renameEpisodeEverywhere('s1', 1, 2, 'Nouveau');

      expect(mockWatchHistoryModel.updateMany).toHaveBeenCalledWith(
        { 'episodes.seriesId': 's1' },
        { $set: { 'episodes.$[e].title': 'Nouveau' } },
        {
          arrayFilters: [
            { 'e.seriesId': 's1', 'e.seasonNumber': 1, 'e.episodeNumber': 2 },
          ],
          timestamps: false,
        },
      );
    });
  });
});
