import { Test, TestingModule } from '@nestjs/testing';
import { UploadThrottlerGuard } from '../media/upload-throttler.guard';
import { SeriesController } from './series.controller';
import { SeriesService } from './series.service';
import { ForbiddenException } from '@nestjs/common';

describe('SeriesController', () => {
  let controller: SeriesController;
  let service: SeriesService;

  const mockSeriesService = {
    createSeries: jest.fn(),
    getAllSeries: jest.fn(),
    getSeriesById: jest.fn(),
    searchSeries: jest.fn(),
    addEpisode: jest.fn(),
    getEpisodes: jest.fn(),
    rateSeries: jest.fn(),
    deleteSeries: jest.fn(),
    getTrendingSeries: jest.fn(),
    getPlayableEpisode: jest.fn(),
    updateAccess: jest.fn(),
    updateSeries: jest.fn(),
    updateEpisode: jest.fn(),
    deleteEpisode: jest.fn(),
    setSeriesImage: jest.fn(),
    removeSeriesImage: jest.fn(),
    setEpisodeThumbnail: jest.fn(),
    removeEpisodeThumbnail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SeriesController],
      providers: [
        {
          provide: SeriesService,
          useValue: mockSeriesService,
        },
      ],
    })
      .overrideGuard(UploadThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SeriesController>(SeriesController);
    service = module.get<SeriesService>(SeriesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllSeries', () => {
    it('should return all series', async () => {
      const mockResult: any = {
        total: 1,
        page: 1,
        limit: 10,
        series: [{ _id: '1', title: 'Test Series' }],
      };

      mockSeriesService.getAllSeries.mockResolvedValue(mockResult);

      const result = await controller.getAllSeries(1, 10);

      expect(result.message).toBe('Series retrieved successfully');
      expect(result.data).toEqual({
        ...mockResult,
        series: [{ _id: '1', title: 'Test Series', categories: [] }],
      });
      expect(service.getAllSeries).toHaveBeenCalledWith(1, 10);
    });
  });

  describe('getSeriesById', () => {
    it('should return a series by ID', async () => {
      const mockSeries: any = { _id: 'test-id', title: 'Test Series' };

      mockSeriesService.getSeriesById.mockResolvedValue(mockSeries);

      const result = await controller.getSeriesById('test-id');

      expect(result.message).toBe('Series retrieved successfully');
      expect(result.series).toEqual({ ...mockSeries, categories: [] });
    });
  });

  describe('searchSeries', () => {
    it('should search series by query', async () => {
      const mockResult: any = {
        total: 1,
        series: [{ _id: '1', title: 'Test Series' }],
      };

      mockSeriesService.searchSeries.mockResolvedValue(mockResult);

      const result = await controller.searchSeries('Test', 1, 10);

      expect(result.message).toBe('Search results');
      expect(result.data).toEqual({
        ...mockResult,
        series: [{ _id: '1', title: 'Test Series', categories: [] }],
      });
      expect(service.searchSeries).toHaveBeenCalledWith('Test', 1, 10);
    });
  });

  describe('getTrendingSeries', () => {
    it('should return trending series', async () => {
      const mockResult: any = [
        { _id: '1', title: 'Popular Series', rating: 9 },
      ];

      mockSeriesService.getTrendingSeries.mockResolvedValue(mockResult);

      const result = await controller.getTrendingSeries(10);

      expect(result.message).toBe('Trending series retrieved');
      expect(result.series).toEqual([{ ...mockResult[0], categories: [] }]);
    });
  });

  describe('createSeries', () => {
    it('should create series if user is admin', async () => {
      const createSeriesDto: any = { title: 'New Series' };
      const mockSeries: any = { _id: 'new-id', ...createSeriesDto };
      const mockRequest: any = { user: { role: 'admin' } };

      mockSeriesService.createSeries.mockResolvedValue(mockSeries);

      const result = await controller.createSeries(
        createSeriesDto,
        mockRequest,
      );

      expect(result.message).toBe('Series created successfully');
      expect(result.series).toEqual({ ...mockSeries, categories: [] });
    });

    it('should throw error if user is not admin', async () => {
      const createSeriesDto: any = { title: 'New Series' };
      const mockRequest: any = { user: { role: 'user' } };

      await expect(
        controller.createSeries(createSeriesDto, mockRequest),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('addEpisode', () => {
    it('should add episode if user is admin', async () => {
      const createEpisodeDto: any = {
        episodeNumber: 1,
        seasonNumber: 1,
        title: 'Ep 1',
        videoUrl: 'url',
        duration: 2520,
      };
      const mockSeries: any = { _id: '1', episodes: [createEpisodeDto] };
      const mockRequest: any = { user: { role: 'admin' } };

      mockSeriesService.addEpisode.mockResolvedValue(mockSeries);

      const result: any = await controller.addEpisode(
        '1',
        createEpisodeDto,
        mockRequest,
      );

      expect(result.message).toBe('Episode added successfully');
      // Spec 0002 AC-5: even admin responses never carry videoUrl
      const { videoUrl, ...publicEpisode } = createEpisodeDto;
      expect(result.series.episodes).toEqual([
        {
          ...publicEpisode,
          thumbnail: null,
          isFree: true,
          // Spec 0006: admin responses carry the video status.
          video: expect.objectContaining({ status: 'legacy', hasPastedUrl: true }),
        },
      ]);
    });

    it('should throw error if user is not admin', async () => {
      const createEpisodeDto: any = {
        episodeNumber: 1,
        seasonNumber: 1,
        title: 'Ep 1',
        videoUrl: 'url',
        duration: 2520,
      };
      const mockRequest: any = { user: { role: 'user' } };

      await expect(
        controller.addEpisode('1', createEpisodeDto, mockRequest),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('rateSeries', () => {
    it('should rate a series', async () => {
      const mockSeries: any = { _id: '1', rating: 8, votes: 1 };

      mockSeriesService.rateSeries.mockResolvedValue(mockSeries);

      const result = await controller.rateSeries('1', { rating: 8 });

      expect(result.message).toBe('Series rated successfully');
      expect(result.series).toEqual({ ...mockSeries, categories: [] });
    });
  });

  describe('content gating (spec 0002)', () => {
    it('never returns videoUrl from the rate route, which any signed in user can call (AC-5)', async () => {
      mockSeriesService.rateSeries.mockResolvedValue({
        _id: '1',
        isPremium: true,
        freeEpisodeCount: 0,
        episodes: [
          {
            seasonNumber: 1,
            episodeNumber: 1,
            title: 'Ep',
            videoUrl: 'secret',
          },
        ],
      });

      const result: any = await controller.rateSeries('1', { rating: 8 });

      expect(JSON.stringify(result)).not.toContain('videoUrl');
      expect(result.series.episodes[0].isFree).toBe(false);
    });

    it('never returns videoUrl from get by id, even for a hydrated document (AC-5)', async () => {
      mockSeriesService.getSeriesById.mockResolvedValue({
        toObject: () => ({
          _id: '1',
          isPremium: false,
          episodes: [{ seasonNumber: 1, episodeNumber: 1, videoUrl: 'secret' }],
        }),
      });

      const result: any = await controller.getSeriesById('1');

      expect(JSON.stringify(result)).not.toContain('videoUrl');
      expect(result.series.episodes[0].isFree).toBe(true);
    });

    it('play passes the authenticated user to the service', async () => {
      const req: any = { user: { _id: 'u1', role: 'user' } };
      mockSeriesService.getPlayableEpisode.mockResolvedValue({
        videoUrl: 'ok',
      });

      const result = await controller.playEpisode('1', 1, 2, req);

      expect(result.data).toEqual({ videoUrl: 'ok' });
      expect(service.getPlayableEpisode).toHaveBeenCalledWith(
        '1',
        1,
        2,
        req.user,
      );
    });

    it('updateAccess is admin only (AC-7)', async () => {
      const req: any = { user: { role: 'user' } };

      await expect(
        controller.updateAccess('1', { isPremium: true }, req),
      ).rejects.toThrow(ForbiddenException);
      expect(service.updateAccess).not.toHaveBeenCalled();
    });
  });

  describe('deleteSeries', () => {
    it('should delete series if user is admin', async () => {
      const mockRequest: any = { user: { role: 'admin' } };
      mockSeriesService.deleteSeries.mockResolvedValue({
        message: 'Series deleted successfully',
      });

      const result = await controller.deleteSeries('1', mockRequest);

      expect(result.message).toBe('Series deleted successfully');
    });

    it('should throw error if user is not admin', async () => {
      const mockRequest: any = { user: { role: 'user' } };

      await expect(controller.deleteSeries('1', mockRequest)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
  describe('management routes (spec 0004 AC-9)', () => {
    const user: any = { user: { role: 'user' } };
    const admin: any = { user: { role: 'admin' } };

    it.each([
      [
        'updateSeries',
        (c: SeriesController, r: any) =>
          c.updateSeries('1', { status: 'completed' }, r),
      ],
      [
        'updateEpisode',
        (c: SeriesController, r: any) =>
          c.updateEpisode('1', 1, 2, { title: 'X' }, r),
      ],
      [
        'deleteEpisode',
        (c: SeriesController, r: any) => c.deleteEpisode('1', 1, 2, r),
      ],
    ] as const)(
      '%s is admin only and maps the result publicly',
      async (method, call) => {
        await expect(call(controller, user)).rejects.toThrow(
          ForbiddenException,
        );
        expect((mockSeriesService as any)[method]).not.toHaveBeenCalled();

        (mockSeriesService as any)[method].mockResolvedValue({
          _id: '1',
          episodes: [
            {
              seasonNumber: 1,
              episodeNumber: 1,
              title: 'Ep',
              videoUrl: 'secret',
            },
          ],
        });
        const result: any = await call(controller, admin);
        expect(JSON.stringify(result)).not.toContain('videoUrl');
        expect(result.series.categories).toEqual([]);
      },
    );

    it('passes the parsed season and episode numbers to the service', async () => {
      mockSeriesService.deleteEpisode.mockResolvedValue({ _id: '1' });
      await controller.deleteEpisode('1', 1, 2, { user: { role: 'admin' } });
      expect(service.deleteEpisode).toHaveBeenCalledWith('1', 1, 2);
    });
  });

  describe('image routes (spec 0005 AC-10)', () => {
    const file = { buffer: Buffer.from('x') } as any;
    const viewer: any = { user: { role: 'user' } };
    const admin: any = { user: { role: 'admin' } };
    const series = { _id: '1', categoryIds: [], episodes: [] };

    it.each([
      ['uploadCover', (c: SeriesController, r: any) => c.uploadCover('1', file, r), 'setSeriesImage'],
      ['removeCover', (c: SeriesController, r: any) => c.removeCover('1', r), 'removeSeriesImage'],
      ['uploadBanner', (c: SeriesController, r: any) => c.uploadBanner('1', file, r), 'setSeriesImage'],
      ['removeBanner', (c: SeriesController, r: any) => c.removeBanner('1', r), 'removeSeriesImage'],
      [
        'uploadEpisodeThumbnail',
        (c: SeriesController, r: any) => c.uploadEpisodeThumbnail('1', 1, 2, file, r),
        'setEpisodeThumbnail',
      ],
      [
        'removeEpisodeThumbnail',
        (c: SeriesController, r: any) => c.removeEpisodeThumbnail('1', 1, 2, r),
        'removeEpisodeThumbnail',
      ],
    ] as const)('%s is admin only and returns { message, series }', async (_n, call, method) => {
      jest.clearAllMocks();
      await expect(call(controller, viewer)).rejects.toThrow(ForbiddenException);
      expect(mockSeriesService[method]).not.toHaveBeenCalled();

      mockSeriesService[method].mockResolvedValue(series);
      const result: any = await call(controller, admin);
      expect(result.message).toEqual(expect.any(String));
      expect(result.series).toMatchObject({ _id: '1', categories: [], episodes: [] });
    });

    it('passes the right slot for cover and banner', async () => {
      jest.clearAllMocks();
      mockSeriesService.setSeriesImage.mockResolvedValue(series);
      await controller.uploadCover('1', file, admin);
      await controller.uploadBanner('1', file, admin);
      expect(mockSeriesService.setSeriesImage).toHaveBeenNthCalledWith(1, '1', 'coverImage', file);
      expect(mockSeriesService.setSeriesImage).toHaveBeenNthCalledWith(2, '1', 'bannerImage', file);
    });
  });
});
