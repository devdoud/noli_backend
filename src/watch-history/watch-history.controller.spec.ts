import { Test, TestingModule } from '@nestjs/testing';
import { WatchHistoryController } from './watch-history.controller';
import { WatchHistoryService } from './watch-history.service';

describe('WatchHistoryController', () => {
  let controller: WatchHistoryController;
  let service: WatchHistoryService;

  const mockWatchHistoryService = {
    addToWatchHistory: jest.fn(),
    getWatchHistory: jest.fn(),
    getContinueWatching: jest.fn(),
    updateProgress: jest.fn(),
    removeFromHistory: jest.fn(),
    clearWatchHistory: jest.fn(),
  };

  // req.user is the full User document (JwtStrategy.validate), keyed by _id, not userId.
  const mockRequest = { user: { _id: 'user-123' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WatchHistoryController],
      providers: [
        {
          provide: WatchHistoryService,
          useValue: mockWatchHistoryService,
        },
      ],
    }).compile();

    controller = module.get<WatchHistoryController>(WatchHistoryController);
    service = module.get<WatchHistoryService>(WatchHistoryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addToWatchHistory', () => {
    it('should add an episode to watch history', async () => {
      const dto: any = {
        seriesId: 'series-1',
        episodeNumber: 1,
        seasonNumber: 1,
        title: 'Pilot',
      };
      const mockResult = { userId: 'user-123', episodes: [dto] };

      mockWatchHistoryService.addToWatchHistory.mockResolvedValue(mockResult);

      const result = await controller.addToWatchHistory(mockRequest, dto);

      expect(result.message).toBe('Episode added to watch history');
      expect(result.data).toEqual(mockResult);
      expect(service.addToWatchHistory).toHaveBeenCalledWith('user-123', dto);
    });
  });

  describe('getWatchHistory', () => {
    it('should return paginated watch history', async () => {
      const mockResult = { total: 5, page: 1, limit: 10, episodes: [] };

      mockWatchHistoryService.getWatchHistory.mockResolvedValue(mockResult);

      const result = await controller.getWatchHistory(mockRequest, {
        page: 1,
        limit: 10,
      });

      expect(result.message).toBe('Watch history retrieved');
      expect(result.data).toEqual(mockResult);
      expect(service.getWatchHistory).toHaveBeenCalledWith('user-123', 1, 10);
    });

    it('should use default page and limit when not provided', async () => {
      const mockResult = { total: 0, episodes: [] };

      mockWatchHistoryService.getWatchHistory.mockResolvedValue(mockResult);

      // Called directly, without the ValidationPipe that fills the defaults.
      await controller.getWatchHistory(mockRequest, {} as any);

      expect(service.getWatchHistory).toHaveBeenCalledWith('user-123', 1, 10);
    });
  });

  describe('getContinueWatching', () => {
    it('should return continue watching list', async () => {
      const mockResult = [{ seriesId: 'series-1', progressPercentage: 45 }];

      mockWatchHistoryService.getContinueWatching.mockResolvedValue(mockResult);

      const result = await controller.getContinueWatching(mockRequest, {
        limit: 5,
      });

      expect(result.message).toBe('Continue watching retrieved');
      expect(result.data).toEqual(mockResult);
      expect(service.getContinueWatching).toHaveBeenCalledWith('user-123', 5);
    });

    it('should use default limit of 5 when not provided', async () => {
      mockWatchHistoryService.getContinueWatching.mockResolvedValue([]);

      await controller.getContinueWatching(mockRequest, {} as any);

      expect(service.getContinueWatching).toHaveBeenCalledWith('user-123', 5);
    });
  });

  describe('updateProgress', () => {
    it('should update episode progress', async () => {
      const mockResult = { progressPercentage: 65 };

      mockWatchHistoryService.updateProgress.mockResolvedValue(mockResult);

      const result = await controller.updateProgress(
        mockRequest,
        'series-1',
        '1',
        '1',
        { progressPercentage: 65 },
      );

      expect(result.message).toBe('Progress updated');
      expect(result.data).toEqual(mockResult);
      expect(service.updateProgress).toHaveBeenCalledWith(
        'user-123',
        'series-1',
        1,
        1,
        65,
      );
    });
  });

  describe('removeFromHistory', () => {
    it('should remove an episode from history', async () => {
      const mockResult = { removed: true };

      mockWatchHistoryService.removeFromHistory.mockResolvedValue(mockResult);

      const result = await controller.removeFromHistory(
        mockRequest,
        'series-1',
        '2',
        '1',
      );

      expect(result.message).toBe('Episode removed from history');
      expect(result.data).toEqual(mockResult);
      expect(service.removeFromHistory).toHaveBeenCalledWith(
        'user-123',
        'series-1',
        2,
        1,
      );
    });
  });

  describe('clearWatchHistory', () => {
    it('should clear the entire watch history', async () => {
      mockWatchHistoryService.clearWatchHistory.mockResolvedValue(undefined);

      const result = await controller.clearWatchHistory(mockRequest);

      expect(result.message).toBe('Watch history cleared');
      expect(service.clearWatchHistory).toHaveBeenCalledWith('user-123');
    });
  });
});
