import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SeriesService, playbackExpiry } from './series.service';
import { Series } from './schemas/series.schema';
import { Category } from '../categories/schemas/category.schema';
import { CATEGORY_POPULATE } from './content-access';
import { WatchHistoryService } from '../watch-history/watch-history.service';
import { MediaService } from '../media/media.service';
import { StreamClient } from '../video/stream.client';
import { VideoStateService } from '../video/video-state.service';
import { NotificationQueue } from '../notifications/notification-queue';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

const mockQueue = { episodePlayable: jest.fn().mockResolvedValue(undefined) };

describe('SeriesService', () => {
  let service: SeriesService;
  let mockSeriesModel: any;
  let mockCategoryModel: any;
  let mockWatchHistory: any;
  let mockMedia: any;
  let mockStream: any;
  let mockVideoState: any;

  const catA = new Types.ObjectId().toString();
  const catB = new Types.ObjectId().toString();

  // findById(id).populate(...) resolving to `result`
  function populated(result: any) {
    return { populate: jest.fn().mockResolvedValue(result) };
  }

  // find(...).select().populate().sort()?.skip()?.limit().lean().exec()
  function listChain(result: any[]) {
    return {
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
  }

  function categoriesFound(ids: string[]) {
    mockCategoryModel.find.mockReturnValue({
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(ids.map((_id) => ({ _id }))),
    });
  }

  beforeEach(async () => {
    mockSeriesModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
      findOneAndUpdate: jest.fn(),
      exists: jest.fn(),
    };
    mockCategoryModel = { find: jest.fn() };
    mockStream = {
      canManage: jest.fn().mockReturnValue(true),
      canPlay: jest.fn().mockReturnValue(true),
      createDirectUpload: jest.fn(),
      createTusUpload: jest.fn(),
      copyFromUrl: jest.fn(),
      getVideo: jest.fn(),
      deleteVideo: jest.fn().mockResolvedValue(undefined),
      signPlaybackToken: jest.fn().mockReturnValue('signed.token'),
      manifestUrl: jest.fn(
        (t: string) => `https://customer-abc.cloudflarestream.com/${t}/manifest/video.m3u8`,
      ),
    };
    mockVideoState = {
      applyStreamState: jest.fn().mockResolvedValue('applied'),
      expireUnusedUpload: jest.fn().mockResolvedValue(false),
    };
    mockMedia = {
      destroyByPrefix: jest.fn().mockResolvedValue(undefined),
      destroyIfOwned: jest.fn().mockResolvedValue(undefined),
      replaceImage: jest.fn(),
      removeImage: jest.fn(),
      seriesFolder: jest.fn((id: string) => `noli/test/series/${id}/`),
      episodeThumbnailPrefix: jest.fn(
        (id: string, s: number, e: number) =>
          `noli/test/series/${id}/episodes/s${s}e${e}-`,
      ),
    };
    mockWatchHistory = {
      removeEpisodeEverywhere: jest.fn().mockResolvedValue(undefined),
      removeSeriesEverywhere: jest.fn().mockResolvedValue(undefined),
      renameEpisodeEverywhere: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeriesService,
        { provide: getModelToken(Series.name), useValue: mockSeriesModel },
        { provide: getModelToken(Category.name), useValue: mockCategoryModel },
        { provide: WatchHistoryService, useValue: mockWatchHistory },
        { provide: MediaService, useValue: mockMedia },
        { provide: StreamClient, useValue: mockStream },
        { provide: VideoStateService, useValue: mockVideoState },
        { provide: NotificationQueue, useValue: mockQueue },
      ],
    }).compile();

    service = module.get<SeriesService>(SeriesService);
  });

  describe('createSeries (AC-7)', () => {
    it('creates with deduplicated category ids and returns the populated series', async () => {
      const dto: any = {
        title: 'Test Series',
        categoryIds: [catA, catA, catB],
      };
      const created = { _id: new Types.ObjectId() };
      const reread = {
        _id: created._id,
        title: 'Test Series',
        categoryIds: [],
      };

      mockSeriesModel.findOne.mockResolvedValue(null);
      categoriesFound([catA, catB]);
      mockSeriesModel.create.mockResolvedValue(created);
      const reReadChain = populated(reread);
      mockSeriesModel.findById.mockReturnValue(reReadChain);

      const result = await service.createSeries(dto);

      expect(result).toBe(reread);
      const createArg = mockSeriesModel.create.mock.calls[0][0];
      expect(createArg.categoryIds.map(String)).toEqual([catA, catB]);
      expect(mockSeriesModel.findById).toHaveBeenCalledWith(created._id);
      expect(reReadChain.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
    });

    it('rejects unknown category ids, naming them, without creating', async () => {
      const dto: any = { title: 'Test Series', categoryIds: [catA, catB] };
      mockSeriesModel.findOne.mockResolvedValue(null);
      categoriesFound([catA]);

      const error = await service.createSeries(dto).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toContain(catB);
      expect(mockSeriesModel.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate title with 409 (spec 0004 AC-2)', async () => {
      mockSeriesModel.findOne.mockResolvedValue({
        _id: 'x',
        title: 'Existing',
      });

      await expect(
        service.createSeries({ title: 'Existing', categoryIds: [catA] } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getAllSeries', () => {
    it('paginates without episodes and populates categories (AC-8)', async () => {
      const chain = listChain([{ _id: '1' }, { _id: '2' }]);
      mockSeriesModel.countDocuments.mockResolvedValue(2);
      mockSeriesModel.find.mockReturnValue(chain);

      const result: any = await service.getAllSeries(1, 10);

      expect(result.total).toBe(2);
      expect(result.series).toHaveLength(2);
      expect(chain.select).toHaveBeenCalledWith('-episodes');
      expect(chain.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
    });
  });

  describe('getSeriesById', () => {
    it('returns the populated series', async () => {
      const series = { _id: 'test-id', title: 'Test Series' };
      const chain = populated(series);
      mockSeriesModel.findById.mockReturnValue(chain);

      const result = await service.getSeriesById('test-id');

      expect(result).toBe(series);
      expect(chain.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
    });

    it('throws NotFoundException if series does not exist', async () => {
      mockSeriesModel.findById.mockReturnValue(populated(null));

      await expect(service.getSeriesById('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('addEpisode (spec 0004 AC-11)', () => {
    const seriesId = new Types.ObjectId().toString();
    const episode: any = {
      episodeNumber: 1,
      seasonNumber: 1,
      title: 'Episode 1',
      videoUrl: 'https://example.com/ep1.m3u8',
      duration: 2520,
    };

    it('adds atomically: refuses a duplicate in the filter, $push and $inc together', async () => {
      const result = { _id: seriesId, totalEpisodes: 1 };
      const chain = populated(result);
      mockSeriesModel.findOneAndUpdate.mockReturnValue(chain);

      expect(await service.addEpisode(seriesId, episode)).toBe(result);

      expect(mockSeriesModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: seriesId,
          episodes: {
            $not: { $elemMatch: { seasonNumber: 1, episodeNumber: 1 } },
          },
        },
        { $push: { episodes: episode }, $inc: { totalEpisodes: 1 } },
        { new: true, runValidators: true },
      );
      expect(chain.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
    });

    it('returns 400 when the episode already exists', async () => {
      mockSeriesModel.findOneAndUpdate.mockReturnValue(populated(null));
      mockSeriesModel.exists.mockResolvedValue({ _id: seriesId });

      await expect(service.addEpisode(seriesId, episode)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns 404 when the series does not exist, or the id is malformed', async () => {
      mockSeriesModel.findOneAndUpdate.mockReturnValue(populated(null));
      mockSeriesModel.exists.mockResolvedValue(null);
      await expect(service.addEpisode(seriesId, episode)).rejects.toThrow(
        NotFoundException,
      );

      await expect(service.addEpisode('bad', episode)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('rateSeries', () => {
    it('updates the average, saves, and returns the re-read populated series (AC-8)', async () => {
      const doc: any = {
        _id: 'test-id',
        rating: 0,
        votes: 0,
        save: jest.fn().mockResolvedValue(undefined),
      };
      const reread = { _id: 'test-id', rating: 8, votes: 1 };
      mockSeriesModel.findById
        .mockResolvedValueOnce(doc)
        .mockReturnValueOnce(populated(reread));

      const result = await service.rateSeries('test-id', 8);

      expect(doc.rating).toBe(8);
      expect(doc.votes).toBe(1);
      expect(result).toBe(reread);
    });

    it('rejects an invalid rating', async () => {
      await expect(service.rateSeries('test-id', 15)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.rateSeries('test-id', -1)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('content gating (spec 0002)', () => {
    const seriesId = '507f1f77bcf86cd799439011';
    const episodes = [
      {
        seasonNumber: 2,
        episodeNumber: 1,
        title: 'S2E1',
        duration: 10,
        videoUrl: 'u21',
      },
      {
        seasonNumber: 1,
        episodeNumber: 2,
        title: 'S1E2',
        duration: 10,
        videoUrl: 'u12',
      },
      {
        seasonNumber: 1,
        episodeNumber: 1,
        title: 'S1E1',
        duration: 10,
        videoUrl: 'u11',
      },
    ];
    const premiumSeries = {
      _id: seriesId,
      isPremium: true,
      freeEpisodeCount: 2,
      episodes,
    };
    const freeUser = {
      role: 'user',
      subscription: { plan: 'free', isActive: true },
    };

    function mockFindByIdLean(result: any) {
      const chain = {
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue(result),
      };
      mockSeriesModel.findById.mockReturnValue(chain);
      return chain;
    }

    describe('getPlayableEpisode', () => {
      it('returns the videoUrl for a teaser episode to a free user (AC-2)', async () => {
        const chain = mockFindByIdLean(premiumSeries);

        const result = await service.getPlayableEpisode(
          seriesId,
          1,
          2,
          freeUser,
        );

        expect(result.videoUrl).toBe('u12');
        expect(chain.select).toHaveBeenCalledWith(
          'episodes isPremium freeEpisodeCount',
        );
      });

      it('refuses a locked episode with the PREMIUM_REQUIRED body (AC-2)', async () => {
        mockFindByIdLean(premiumSeries);

        const error = await service
          .getPlayableEpisode(seriesId, 2, 1, freeUser)
          .catch((e) => e);

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.getResponse()).toEqual({
          statusCode: 403,
          code: 'PREMIUM_REQUIRED',
          message: 'Premium subscription required',
        });
      });

      it('returns 404 for a malformed id without querying (AC-4)', async () => {
        await expect(
          service.getPlayableEpisode('not-an-id', 1, 1, freeUser),
        ).rejects.toThrow(NotFoundException);
        expect(mockSeriesModel.findById).not.toHaveBeenCalled();
      });

      it('returns 404 for an unknown series or episode (AC-4)', async () => {
        mockFindByIdLean(null);
        await expect(
          service.getPlayableEpisode(seriesId, 1, 1, freeUser),
        ).rejects.toThrow(NotFoundException);

        mockFindByIdLean(premiumSeries);
        await expect(
          service.getPlayableEpisode(seriesId, 9, 9, freeUser),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('getEpisodes', () => {
      it('orders by (season, episode), computes isFree before paginating, and drops videoUrl', async () => {
        const chain = mockFindByIdLean(premiumSeries);

        const page2 = await service.getEpisodes(seriesId, 2, 1);
        const page3 = await service.getEpisodes(seriesId, 3, 1);

        expect(chain.select).toHaveBeenCalledWith(
          'episodes isPremium freeEpisodeCount',
        );
        expect(page2.total).toBe(3);
        expect(page2.episodes).toEqual([
          {
            seasonNumber: 1,
            episodeNumber: 2,
            title: 'S1E2',
            duration: 10,
            thumbnail: null,
            isFree: true,
          },
        ]);
        expect(page3.episodes[0]).toMatchObject({
          title: 'S2E1',
          isFree: false,
        });
        expect(JSON.stringify(page3)).not.toContain('videoUrl');
      });
    });

    describe('updateAccess', () => {
      it('rejects an empty body', async () => {
        await expect(service.updateAccess(seriesId, {})).rejects.toThrow(
          BadRequestException,
        );
        expect(mockSeriesModel.findByIdAndUpdate).not.toHaveBeenCalled();
      });

      it('sets only the provided access fields, with validators, and populates (AC-8)', async () => {
        const chain = populated({ _id: seriesId, isPremium: true });
        mockSeriesModel.findByIdAndUpdate.mockReturnValue(chain);

        await service.updateAccess(seriesId, { isPremium: true });

        expect(mockSeriesModel.findByIdAndUpdate).toHaveBeenCalledWith(
          seriesId,
          { $set: { isPremium: true } },
          { new: true, runValidators: true },
        );
        expect(chain.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
      });

      it('returns 404 for an unknown series', async () => {
        mockSeriesModel.findByIdAndUpdate.mockReturnValue(populated(null));
        await expect(
          service.updateAccess(seriesId, { freeEpisodeCount: 1 }),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('updateSeries (spec 0004 AC-1, AC-2)', () => {
    const id = new Types.ObjectId().toString();

    it('sets only the provided editable fields, with validators, and populates', async () => {
      const chain = populated({ _id: id });
      mockSeriesModel.findByIdAndUpdate.mockReturnValue(chain);
      mockSeriesModel.exists.mockResolvedValue(null);

      await service.updateSeries(id, {
        title: 'New title',
        description: null,
        isPremium: true,
        rating: 10,
      } as any);

      expect(mockSeriesModel.findByIdAndUpdate).toHaveBeenCalledWith(
        id,
        { $set: { title: 'New title', description: null, isPremium: true } },
        { new: true, runValidators: true },
      );
      expect(chain.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
    });

    it('validates and deduplicates categoryIds like create', async () => {
      categoriesFound([catA]);
      mockSeriesModel.findByIdAndUpdate.mockReturnValue(populated({ _id: id }));

      await service.updateSeries(id, { categoryIds: [catA, catA] });

      const set = mockSeriesModel.findByIdAndUpdate.mock.calls[0][1].$set;
      expect(set.categoryIds.map(String)).toEqual([catA]);

      categoriesFound([]);
      await expect(
        service.updateSeries(id, { categoryIds: [catB] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns 409 for a title used by another series, before writing', async () => {
      mockSeriesModel.exists.mockResolvedValue({ _id: 'other' });

      await expect(
        service.updateSeries(id, { title: 'Taken' }),
      ).rejects.toThrow(ConflictException);
      expect(mockSeriesModel.exists).toHaveBeenCalledWith({
        title: 'Taken',
        _id: { $ne: id },
      });
      expect(mockSeriesModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('maps a racing duplicate key error to 409 and a validation error to 400', async () => {
      mockSeriesModel.exists.mockResolvedValue(null);
      mockSeriesModel.findByIdAndUpdate.mockReturnValue({
        populate: jest.fn().mockRejectedValue({ code: 11000 }),
      });
      await expect(service.updateSeries(id, { title: 'Race' })).rejects.toThrow(
        ConflictException,
      );

      const { Error: MongooseError } = jest.requireActual('mongoose');
      const validation = new MongooseError.ValidationError();
      mockSeriesModel.findByIdAndUpdate.mockReturnValue({
        populate: jest.fn().mockRejectedValue(validation),
      });
      await expect(
        service.updateSeries(id, { releaseYear: 2020 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a body with no editable field, then a malformed id', async () => {
      await expect(
        service.updateSeries(id, { rating: 5 } as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateSeries('bad', { status: 'completed' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 404 for an unknown series', async () => {
      mockSeriesModel.findByIdAndUpdate.mockReturnValue(populated(null));
      await expect(
        service.updateSeries(id, { status: 'completed' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateEpisode (spec 0004 AC-4, AC-5)', () => {
    const id = new Types.ObjectId().toString();

    it('updates the matched episode through the positional operator', async () => {
      mockSeriesModel.findOneAndUpdate.mockReturnValue(populated({ _id: id }));

      await service.updateEpisode(id, 1, 2, {
        duration: 1500,
        description: null,
      });

      expect(mockSeriesModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: id,
          episodes: { $elemMatch: { seasonNumber: 1, episodeNumber: 2 } },
        },
        {
          $set: { 'episodes.$.description': null, 'episodes.$.duration': 1500 },
        },
        { new: true, runValidators: true },
      );
      expect(mockWatchHistory.renameEpisodeEverywhere).not.toHaveBeenCalled();
    });

    it('renames the episode in every watch history when the title changes', async () => {
      mockSeriesModel.findOneAndUpdate.mockReturnValue(populated({ _id: id }));

      await service.updateEpisode(id, 1, 2, { title: 'Nouveau titre' });

      expect(mockWatchHistory.renameEpisodeEverywhere).toHaveBeenCalledWith(
        id,
        1,
        2,
        'Nouveau titre',
      );
    });

    it('returns 404 for an unknown episode without touching history', async () => {
      mockSeriesModel.findOneAndUpdate.mockReturnValue(populated(null));

      await expect(
        service.updateEpisode(id, 9, 9, { title: 'X' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockWatchHistory.renameEpisodeEverywhere).not.toHaveBeenCalled();
    });

    it('rejects an empty body', async () => {
      await expect(service.updateEpisode(id, 1, 1, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('deleteEpisode (spec 0004 AC-6, AC-8)', () => {
    const id = new Types.ObjectId().toString();

    // Spec 0006: the episode or series is read first to find its videos.
    beforeEach(() => {
      mockSeriesModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      mockSeriesModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });
    });

    it('pulls the episode and decrements the count atomically, then cleans history', async () => {
      const result = { _id: id, totalEpisodes: 2 };
      mockSeriesModel.findOneAndUpdate.mockReturnValue(populated(result));

      expect(await service.deleteEpisode(id, 1, 2)).toBe(result);

      expect(mockSeriesModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: id,
          episodes: { $elemMatch: { seasonNumber: 1, episodeNumber: 2 } },
        },
        {
          $pull: { episodes: { seasonNumber: 1, episodeNumber: 2 } },
          $inc: { totalEpisodes: -1 },
        },
        { new: true },
      );
      expect(mockWatchHistory.removeEpisodeEverywhere).toHaveBeenCalledWith(
        id,
        1,
        2,
      );
    });

    it('still cleans history when the episode is already gone, so a retry repairs it', async () => {
      mockSeriesModel.findOneAndUpdate.mockReturnValue(populated(null));

      await expect(service.deleteEpisode(id, 1, 2)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockWatchHistory.removeEpisodeEverywhere).toHaveBeenCalledWith(
        id,
        1,
        2,
      );
    });
  });

  describe('deleteSeries (spec 0004 AC-7, AC-8)', () => {
    const id = new Types.ObjectId().toString();

    // Spec 0006: the episode or series is read first to find its videos.
    beforeEach(() => {
      mockSeriesModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      mockSeriesModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });
    });

    it('deletes the series and removes it from every watch history', async () => {
      mockSeriesModel.findByIdAndDelete.mockResolvedValue({ _id: id });

      const result = await service.deleteSeries(id);

      expect(result.message).toBe('Series deleted successfully');
      expect(mockWatchHistory.removeSeriesEverywhere).toHaveBeenCalledWith(id);
    });

    it('returns 404 when already gone, but still cleans history', async () => {
      mockSeriesModel.findByIdAndDelete.mockResolvedValue(null);

      await expect(service.deleteSeries(id)).rejects.toThrow(NotFoundException);
      expect(mockWatchHistory.removeSeriesEverywhere).toHaveBeenCalledWith(id);
    });

    it('returns 404 for a malformed id without touching anything', async () => {
      await expect(service.deleteSeries('test-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockSeriesModel.findByIdAndDelete).not.toHaveBeenCalled();
      expect(mockWatchHistory.removeSeriesEverywhere).not.toHaveBeenCalled();
    });
  });

  describe('images (spec 0005)', () => {
    const id = new Types.ObjectId().toString();
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;
    const pasted = 'https://example.com/old.jpg';

    it('setSeriesImage hands the current URL to replaceImage and saves with a compare and set filter (AC-1, AC-13)', async () => {
      const current = { _id: id, coverImage: pasted, episodes: [] };
      mockSeriesModel.findById.mockReturnValue(populated(current));
      mockMedia.replaceImage.mockResolvedValue('saved');

      await expect(service.setSeriesImage(id, 'coverImage', file)).resolves.toBe('saved');

      const opts = mockMedia.replaceImage.mock.calls[0][0];
      expect(opts).toMatchObject({
        file,
        slot: 'seriesCover',
        owner: { seriesId: id },
        currentUrl: pasted,
      });
      mockSeriesModel.findOneAndUpdate.mockReturnValue(populated('doc'));
      await expect(opts.save(pasted, 'https://new')).resolves.toBe('doc');
      expect(mockSeriesModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id, coverImage: pasted },
        { $set: { coverImage: 'https://new' } },
        { new: true },
      );
    });

    it('the banner uses its own slot', async () => {
      mockSeriesModel.findById.mockReturnValue(populated({ _id: id, episodes: [] }));
      await service.setSeriesImage(id, 'bannerImage', file);
      expect(mockMedia.replaceImage.mock.calls[0][0]).toMatchObject({
        slot: 'seriesBanner',
        currentUrl: null,
      });
    });

    it('returns 404 for a malformed or unknown series before any upload (AC-10)', async () => {
      await expect(service.setSeriesImage('bad', 'coverImage', file)).rejects.toThrow(
        NotFoundException,
      );
      mockSeriesModel.findById.mockReturnValue(populated(null));
      await expect(service.setSeriesImage(id, 'coverImage', file)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockMedia.replaceImage).not.toHaveBeenCalled();
    });

    it('removeSeriesImage sets the slot back to null with the same filter (AC-7)', async () => {
      const current = { _id: id, bannerImage: pasted, episodes: [] };
      mockSeriesModel.findById.mockReturnValue(populated(current));
      mockMedia.removeImage.mockResolvedValue('cleared');

      await expect(service.removeSeriesImage(id, 'bannerImage')).resolves.toBe('cleared');

      const opts = mockMedia.removeImage.mock.calls[0][0];
      expect(opts).toMatchObject({ slot: 'seriesBanner', current, currentUrl: pasted });
      mockSeriesModel.findOneAndUpdate.mockReturnValue(populated('doc'));
      await opts.save(pasted);
      expect(mockSeriesModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: id, bannerImage: pasted },
        { $set: { bannerImage: null } },
        { new: true },
      );
    });

    it('the episode thumbnail matches the episode and its current thumbnail, and 404s on an unknown episode (AC-2)', async () => {
      const series = {
        _id: id,
        episodes: [{ seasonNumber: 1, episodeNumber: 2 }],
      };
      mockSeriesModel.findById.mockReturnValue(populated(series));
      await service.setEpisodeThumbnail(id, 1, 2, file);

      const opts = mockMedia.replaceImage.mock.calls[0][0];
      expect(opts).toMatchObject({
        slot: 'episodeThumbnail',
        owner: { seriesId: id, seasonNumber: 1, episodeNumber: 2 },
        currentUrl: null,
      });
      mockSeriesModel.findOneAndUpdate.mockReturnValue({
        populate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue('doc') }),
      });
      await expect(opts.save(null, 'https://new')).resolves.toBe('doc');
      expect(mockSeriesModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          _id: id,
          episodes: {
            $elemMatch: { seasonNumber: 1, episodeNumber: 2, thumbnail: null },
          },
        },
        { $set: { 'episodes.$.thumbnail': 'https://new' } },
        { new: true },
      );

      mockSeriesModel.exists.mockResolvedValue(null);
      await expect(opts.exists()).resolves.toBe(false);
      expect(mockSeriesModel.exists).toHaveBeenCalledWith({
        _id: id,
        episodes: { $elemMatch: { seasonNumber: 1, episodeNumber: 2 } },
      });

      mockSeriesModel.findById.mockReturnValue(populated(series));
      await expect(service.setEpisodeThumbnail(id, 9, 9, file)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('a pasted cover on PATCH reads the old value from the same write and deletes the owned file it replaced (AC-9)', async () => {
      const lean = jest
        .fn()
        .mockResolvedValue({ coverImage: 'https://old', bannerImage: 'https://keep' });
      mockSeriesModel.findByIdAndUpdate.mockReturnValue({
        select: jest.fn().mockReturnValue({ lean }),
      });
      mockSeriesModel.findById.mockReturnValue(populated({ _id: id }));

      await service.updateSeries(id, {
        coverImage: 'https://new',
        bannerImage: 'https://keep',
      });

      expect(mockSeriesModel.findByIdAndUpdate).toHaveBeenCalledWith(
        id,
        { $set: { coverImage: 'https://new', bannerImage: 'https://keep' } },
        { new: false, runValidators: true },
      );
      expect(mockMedia.destroyIfOwned).toHaveBeenCalledTimes(1);
      expect(mockMedia.destroyIfOwned).toHaveBeenCalledWith(
        'https://old',
        'seriesCover',
        { seriesId: id },
      );
    });

    it('deleting an episode cleans its thumbnail, also on the 404 retry (AC-8)', async () => {
      mockSeriesModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      });
      mockSeriesModel.findOneAndUpdate.mockReturnValue(populated(null));
      await expect(service.deleteEpisode(id, 1, 2)).rejects.toThrow(NotFoundException);
      expect(mockMedia.destroyByPrefix).toHaveBeenCalledWith(
        `noli/test/series/${id}/episodes/s1e2-`,
      );
    });

    it('deleting a series cleans its whole folder, also on the 404 retry (AC-8)', async () => {
      mockSeriesModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      });
      mockSeriesModel.findByIdAndDelete.mockResolvedValue({ _id: id });
      await service.deleteSeries(id);
      mockSeriesModel.findByIdAndDelete.mockResolvedValue(null);
      await expect(service.deleteSeries(id)).rejects.toThrow(NotFoundException);
      expect(mockMedia.destroyByPrefix).toHaveBeenNthCalledWith(1, `noli/test/series/${id}/`);
      expect(mockMedia.destroyByPrefix).toHaveBeenNthCalledWith(2, `noli/test/series/${id}/`);
    });
  });

  describe('episode videos (spec 0006)', () => {
    const id = new Types.ObjectId().toString();
    const episode = (fields: Record<string, unknown> = {}) => ({
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Pilote',
      duration: 1500,
      ...fields,
    });
    const seriesWith = (fields: Record<string, unknown> = {}) => ({
      _id: id,
      title: 'Noli',
      isPremium: false,
      freeEpisodeCount: 0,
      episodes: [episode(fields)],
    });
    const lean = (result: unknown) => ({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(result),
    });

    describe('requestVideoUpload (AC-1, AC-11)', () => {
      beforeEach(() => {
        mockSeriesModel.findById.mockReturnValue(populated(seriesWith()));
        mockSeriesModel.findOneAndUpdate.mockResolvedValue({ _id: id });
        mockStream.createDirectUpload.mockResolvedValue({ uid: 'u1', uploadUrl: 'https://up/u1' });
        mockStream.createTusUpload.mockResolvedValue({ uid: 't1', uploadUrl: 'https://tus/t1' });
      });

      it('gives a basic upload link up to 200 MB, capped at 3 hours, expiring in 5 h 55', async () => {
        const before = Date.now();
        const ticket = await service.requestVideoUpload(id, 1, 1, 200 * 1024 * 1024);

        expect(ticket).toMatchObject({ method: 'post', uploadUrl: 'https://up/u1', uid: 'u1' });
        const lifetime = ticket.expiresAt.getTime() - before;
        expect(lifetime).toBeGreaterThanOrEqual(355 * 60 * 1000 - 1000);
        expect(lifetime).toBeLessThan(6 * 3600 * 1000);
        expect(mockStream.createDirectUpload).toHaveBeenCalledWith(
          expect.objectContaining({
            maxDurationSeconds: 10800,
            meta: { name: 'Noli S1E1 Pilote', seriesId: id, seasonNumber: 1, episodeNumber: 1 },
          }),
        );
        const [filter, update] = mockSeriesModel.findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({
          _id: id,
          episodes: { $elemMatch: { seasonNumber: 1, episodeNumber: 1, pendingStreamUid: null } },
        });
        expect(update.$set).toMatchObject({
          'episodes.$.pendingStreamUid': 'u1',
          'episodes.$.pendingStatus': 'awaiting_upload',
          'episodes.$.pendingError': null,
          'episodes.$.pendingExpiresAt': ticket.expiresAt,
        });
      });

      it('switches to a resumable tus upload above 200 MB', async () => {
        const ticket = await service.requestVideoUpload(id, 1, 1, 200 * 1024 * 1024 + 1);
        expect(ticket).toMatchObject({ method: 'tus', uid: 't1' });
        expect(mockStream.createTusUpload).toHaveBeenCalledWith(
          expect.objectContaining({ uploadLength: 200 * 1024 * 1024 + 1 }),
        );
      });

      it('replaces a pending video and deletes the old one at Cloudflare', async () => {
        mockSeriesModel.findById.mockReturnValue(
          populated(seriesWith({ pendingStreamUid: 'old', pendingStatus: 'processing' })),
        );
        await service.requestVideoUpload(id, 1, 1, 1000);
        expect(
          mockSeriesModel.findOneAndUpdate.mock.calls[0][0].episodes.$elemMatch.pendingStreamUid,
        ).toBe('old');
        expect(mockStream.deleteVideo).toHaveBeenCalledWith('old');
      });

      it('loses a race with 409 and deletes its own fresh video', async () => {
        mockSeriesModel.findOneAndUpdate.mockResolvedValue(null);
        mockSeriesModel.exists.mockResolvedValue({ _id: id });
        await expect(service.requestVideoUpload(id, 1, 1, 1000)).rejects.toThrow(ConflictException);
        expect(mockStream.deleteVideo).toHaveBeenCalledWith('u1');
      });

      it('answers 404 when the episode disappeared in the meantime', async () => {
        mockSeriesModel.findOneAndUpdate.mockResolvedValue(null);
        mockSeriesModel.exists.mockResolvedValue(null);
        await expect(service.requestVideoUpload(id, 1, 1, 1000)).rejects.toThrow(NotFoundException);
      });

      it('answers 404 for an unknown episode and 503 without Cloudflare credentials (AC-14, AC-15)', async () => {
        await expect(service.requestVideoUpload(id, 9, 9, 1000)).rejects.toThrow(NotFoundException);
        mockStream.canManage.mockReturnValue(false);
        await expect(service.requestVideoUpload(id, 1, 1, 1000)).rejects.toThrow(
          ServiceUnavailableException,
        );
        expect(mockStream.createDirectUpload).not.toHaveBeenCalled();
      });
    });

    it('imports from a link as processing (AC-2)', async () => {
      mockSeriesModel.findById.mockReturnValue(populated(seriesWith()));
      mockSeriesModel.findOneAndUpdate.mockResolvedValue({ _id: id });
      mockStream.copyFromUrl.mockResolvedValue({ uid: 'c1' });

      await expect(service.importVideo(id, 1, 1, 'https://cdn/x.mp4')).resolves.toEqual({
        uid: 'c1',
        pendingStatus: 'processing',
      });
      expect(mockSeriesModel.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
        'episodes.$.pendingStatus': 'processing',
        'episodes.$.pendingExpiresAt': null,
      });
    });

    it('refresh reads the pending video from Cloudflare and applies its state (AC-6)', async () => {
      mockSeriesModel.findById.mockReturnValue(
        populated(seriesWith({ pendingStreamUid: 'p1', pendingStatus: 'processing' })),
      );
      mockStream.getVideo.mockResolvedValue({ status: { state: 'ready' }, duration: 1400 });

      await service.refreshVideo(id, 1, 1);

      expect(mockStream.getVideo).toHaveBeenCalledWith('p1');
      expect(mockVideoState.applyStreamState).toHaveBeenCalledWith(
        expect.objectContaining({ uid: 'p1', status: { state: 'ready' } }),
      );
    });

    it('removing a video clears the database first, then deletes both videos (AC-12)', async () => {
      mockSeriesModel.findById.mockReturnValue(
        populated(seriesWith({ streamUid: 'cur', pendingStreamUid: 'pend', videoUrl: 'https://old' })),
      );
      const order: string[] = [];
      mockSeriesModel.updateOne = jest.fn(async () => {
        order.push('db');
        return { modifiedCount: 1 };
      });
      mockStream.deleteVideo.mockImplementation(async (uid: string) => {
        if (uid) order.push(`cf:${uid}`);
      });

      await service.removeVideo(id, 1, 1);

      expect(order).toEqual(['db', 'cf:cur', 'cf:pend']);
      expect(mockSeriesModel.updateOne.mock.calls[0][1].$set).toMatchObject({
        'episodes.$.streamUid': null,
        'episodes.$.pendingStreamUid': null,
        'episodes.$.videoUrl': null,
      });
    });

    describe('play (AC-7, AC-9, AC-15)', () => {
      const user = { role: 'user' };

      it('returns a signed HLS link expiring at now + 2 x length + 1 h', async () => {
        mockSeriesModel.findById.mockReturnValue(
          lean(seriesWith({ streamUid: 'cf1', streamDuration: 1400 })),
        );
        const before = Date.now();

        const result = await service.getPlayableEpisode(id, 1, 1, user);

        expect(result).toMatchObject({
          type: 'hls',
          videoUrl: 'https://customer-abc.cloudflarestream.com/signed.token/manifest/video.m3u8',
        });
        // L = max(1400, duration 1500) = 1500 s.
        const lifetime = (result.expiresAt as Date).getTime() - before;
        expect(lifetime).toBeGreaterThanOrEqual((2 * 1500 + 3600) * 1000 - 1000);
        expect(lifetime).toBeLessThanOrEqual((2 * 1500 + 3600) * 1000 + 1000);
        expect(mockStream.signPlaybackToken).toHaveBeenCalledWith('cf1', result.expiresAt);
      });

      it('caps the link at Cloudflare 24 hours', () => {
        const now = new Date('2026-10-01T00:00:00Z');
        expect(playbackExpiry(now, 50_000, 0).getTime() - now.getTime()).toBe(24 * 3600 * 1000);
      });

      it('keeps returning a pasted link unchanged, even without Cloudflare', async () => {
        mockStream.canPlay.mockReturnValue(false);
        mockSeriesModel.findById.mockReturnValue(lean(seriesWith({ videoUrl: 'https://old/e1.mp4' })));

        const result = await service.getPlayableEpisode(id, 1, 1, user);

        expect(result).toMatchObject({ type: 'direct', videoUrl: 'https://old/e1.mp4', expiresAt: null });
      });

      it('answers 503 for a Cloudflare video without the signing variables', async () => {
        mockStream.canPlay.mockReturnValue(false);
        mockSeriesModel.findById.mockReturnValue(lean(seriesWith({ streamUid: 'cf1' })));
        await expect(service.getPlayableEpisode(id, 1, 1, user)).rejects.toThrow(
          ServiceUnavailableException,
        );
      });

      it('answers 404 for an episode with no playable video, before the premium check', async () => {
        mockSeriesModel.findById.mockReturnValue(
          lean({ ...seriesWith({ pendingStreamUid: 'p', pendingStatus: 'processing' }), isPremium: true }),
        );
        await expect(service.getPlayableEpisode(id, 1, 1, user)).rejects.toThrow(NotFoundException);
      });
    });

    it('lists only playable episodes to viewers, with a playable total (AC-9)', async () => {
      mockSeriesModel.findById.mockReturnValue(
        lean({
          isPremium: false,
          freeEpisodeCount: 0,
          episodes: [
            episode({ episodeNumber: 1, pendingStreamUid: 'p', pendingStatus: 'processing' }),
            episode({ episodeNumber: 2, streamUid: 'cf2' }),
            episode({ episodeNumber: 3, videoUrl: 'https://old' }),
          ],
        }),
      );

      const result = await service.getEpisodes(id, 1, 10);

      expect(result.total).toBe(2);
      expect(result.episodes.map((e: any) => e.episodeNumber)).toEqual([2, 3]);
    });

    it('deleting an episode deletes its Cloudflare videos before the episode (AC-13)', async () => {
      const order: string[] = [];
      mockSeriesModel.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          episodes: [{ streamUid: 'cur', pendingStreamUid: 'pend' }],
        }),
      });
      mockStream.deleteVideo.mockImplementation(async (uid: string) => {
        if (uid) order.push(`cf:${uid}`);
      });
      mockSeriesModel.findOneAndUpdate.mockImplementation(() => {
        order.push('db');
        return populated({ _id: id });
      });

      await service.deleteEpisode(id, 1, 1);

      expect(order).toEqual(['cf:cur', 'cf:pend', 'db']);
    });

    it('deleting a series deletes every referenced video first (AC-13)', async () => {
      const order: string[] = [];
      mockSeriesModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            episodes: [{ streamUid: 'a' }, { pendingStreamUid: 'b' }],
          }),
        }),
      });
      mockStream.deleteVideo.mockImplementation(async (uid: string) => {
        if (uid) order.push(`cf:${uid}`);
      });
      mockSeriesModel.findByIdAndDelete.mockImplementation(async () => {
        order.push('db');
        return { _id: id };
      });

      await service.deleteSeries(id);

      expect(order).toEqual(['cf:a', 'cf:b', 'db']);
    });

    it('the admin view expires unused upload links on the way (AC-16)', async () => {
      mockSeriesModel.findById.mockReturnValue(
        populated(seriesWith({ pendingStreamUid: 'u', pendingStatus: 'awaiting_upload' })),
      );
      mockVideoState.expireUnusedUpload.mockResolvedValue(true);

      await service.getSeriesForAdmin(id);

      expect(mockVideoState.expireUnusedUpload).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ pendingStreamUid: 'u' }),
      );
      expect(mockSeriesModel.findById).toHaveBeenCalledTimes(2);
    });
  });
});
