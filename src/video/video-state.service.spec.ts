import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { Series } from '../series/schemas/series.schema';
import { StreamClient } from './stream.client';
import { VideoStateService } from './video-state.service';
import { NotificationQueue } from '../notifications/notification-queue';

const SERIES_ID = new Types.ObjectId();

function leanChain(result: unknown) {
  return {
    select: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(result) }),
  };
}

const queue = { episodePlayable: jest.fn().mockResolvedValue(undefined) };

describe('VideoStateService (spec 0006)', () => {
  let service: VideoStateService;
  let model: any;
  let stream: any;

  const holder = (episode: Record<string, unknown>) => ({
    _id: SERIES_ID,
    episodes: [
      { seasonNumber: 1, episodeNumber: 1, duration: 1500, ...episode },
    ],
  });

  beforeEach(async () => {
    model = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      exists: jest.fn().mockResolvedValue(null),
    };
    stream = {
      env: 'development',
      deleteVideo: jest.fn().mockResolvedValue(undefined),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideoStateService,
        { provide: getModelToken(Series.name), useValue: model },
        { provide: StreamClient, useValue: stream },
        { provide: NotificationQueue, useValue: queue },
      ],
    }).compile();
    service = moduleRef.get(VideoStateService);
  });

  describe('ready (AC-3)', () => {
    it('switches the episode in one write keyed by the uid, then deletes the replaced video', async () => {
      model.findOne.mockReturnValue(
        leanChain(holder({ pendingStreamUid: 'new', streamUid: 'old' })),
      );
      model.findOneAndUpdate.mockReturnValue(
        leanChain(holder({ pendingStreamUid: 'new', streamUid: 'old' })),
      );

      const outcome = await service.applyStreamState({
        uid: 'new',
        duration: 1490.6,
        status: { state: 'ready' },
        meta: { env: 'development' },
      });

      expect(outcome).toBe('applied');
      const [filter, update, options] = model.findOneAndUpdate.mock.calls[0];
      expect(filter).toEqual({
        _id: SERIES_ID,
        'episodes.pendingStreamUid': 'new',
      });
      expect(update.$set).toEqual({
        'episodes.$[e].streamUid': 'new',
        'episodes.$[e].streamDuration': 1491,
        'episodes.$[e].pendingStreamUid': null,
        'episodes.$[e].pendingStatus': null,
        'episodes.$[e].pendingError': null,
        'episodes.$[e].pendingExpiresAt': null,
        'episodes.$[e].videoUrl': null,
      });
      expect(options).toEqual({
        arrayFilters: [{ 'e.pendingStreamUid': 'new' }],
        returnDocument: 'before',
      });
      expect(stream.deleteVideo).toHaveBeenCalledWith('old');
    });

    it("falls back to the episode's duration when Cloudflare reports none", async () => {
      model.findOne.mockReturnValue(
        leanChain(holder({ pendingStreamUid: 'new' })),
      );
      model.findOneAndUpdate.mockReturnValue(
        leanChain(holder({ pendingStreamUid: 'new' })),
      );

      await service.applyStreamState({
        uid: 'new',
        duration: -1,
        status: { state: 'ready' },
      });

      expect(
        model.findOneAndUpdate.mock.calls[0][1].$set[
          'episodes.$[e].streamDuration'
        ],
      ).toBe(1500);
      expect(stream.deleteVideo).not.toHaveBeenCalled();
    });

    it('does not switch on readyToStream alone while still encoding', async () => {
      model.findOne.mockReturnValue(
        leanChain(
          holder({ pendingStreamUid: 'new', pendingStatus: 'processing' }),
        ),
      );
      const outcome = await service.applyStreamState({
        uid: 'new',
        readyToStream: true,
        status: { state: 'inprogress' },
      });
      expect(outcome).toBe('unchanged');
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('treats a repeated delivery as harmless (AC-5)', async () => {
      model.findOne.mockReturnValue(leanChain(null));
      model.exists.mockResolvedValue({ _id: SERIES_ID });

      const outcome = await service.applyStreamState({
        uid: 'new',
        status: { state: 'ready' },
      });

      expect(outcome).toBe('repeat');
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('changes nothing when the episode was replaced between the read and the write', async () => {
      model.findOne.mockReturnValue(
        leanChain(holder({ pendingStreamUid: 'new' })),
      );
      model.findOneAndUpdate.mockReturnValue(leanChain(null));
      expect(
        await service.applyStreamState({
          uid: 'new',
          status: { state: 'ready' },
        }),
      ).toBe('unchanged');
    });
  });

  it('records a processing failure with code and text, keeping the current video (AC-4)', async () => {
    model.findOne.mockReturnValue(
      leanChain(holder({ pendingStreamUid: 'new', streamUid: 'playing' })),
    );

    const outcome = await service.applyStreamState({
      uid: 'new',
      status: {
        state: 'error',
        errorReasonCode: 'ERR_DURATION_EXCEED_CONSTRAINT',
        errorReasonText: 'Too long',
      },
    });

    expect(outcome).toBe('applied');
    const [, update, options] = model.updateOne.mock.calls[0];
    expect(update.$set).toEqual({
      'episodes.$[e].pendingStatus': 'error',
      'episodes.$[e].pendingError': 'ERR_DURATION_EXCEED_CONSTRAINT: Too long',
      'episodes.$[e].pendingExpiresAt': null,
    });
    expect(options.arrayFilters).toEqual([{ 'e.pendingStreamUid': 'new' }]);
    expect(stream.deleteVideo).not.toHaveBeenCalled();
  });

  it('marks an uploading or encoding video as processing (refresh, AC-6)', async () => {
    model.findOne.mockReturnValue(
      leanChain(
        holder({ pendingStreamUid: 'new', pendingStatus: 'awaiting_upload' }),
      ),
    );
    await service.applyStreamState({ uid: 'new', status: { state: 'queued' } });
    expect(
      model.updateOne.mock.calls[0][1].$set['episodes.$[e].pendingStatus'],
    ).toBe('processing');
  });

  it("ignores another environment's video (AC-5)", async () => {
    const outcome = await service.applyStreamState({
      uid: 'x',
      status: { state: 'ready' },
      meta: { env: 'production' },
    });
    expect(outcome).toBe('ignored');
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('retries the lookup of an unknown uid before giving up (AC-5)', async () => {
    jest.useFakeTimers();
    model.findOne
      .mockReturnValueOnce(leanChain(null))
      .mockReturnValueOnce(leanChain(holder({ pendingStreamUid: 'late' })));
    model.findOneAndUpdate.mockReturnValue(
      leanChain(holder({ pendingStreamUid: 'late' })),
    );

    const pending = service.applyStreamState(
      { uid: 'late', status: { state: 'ready' } },
      { retryUnknown: true },
    );
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toBe('applied');
    jest.useRealTimers();
  });

  it('gives up on a truly unknown uid without changing anything', async () => {
    model.findOne.mockReturnValue(leanChain(null));
    expect(
      await service.applyStreamState({
        uid: 'ghost',
        status: { state: 'ready' },
      }),
    ).toBe('unknown');
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  describe('expireUnusedUpload (AC-16)', () => {
    const now = new Date('2026-10-01T12:00:00Z');

    it('marks a link past its expiry as upload_expired and deletes the video', async () => {
      const changed = await service.expireUnusedUpload(
        String(SERIES_ID),
        {
          seasonNumber: 1,
          episodeNumber: 1,
          pendingStreamUid: 'u1',
          pendingStatus: 'awaiting_upload',
          pendingExpiresAt: new Date('2026-10-01T11:00:00Z'),
        },
        now,
      );
      expect(changed).toBe(true);
      expect(
        model.updateOne.mock.calls[0][1].$set['episodes.$[e].pendingError'],
      ).toBe('upload_expired');
      expect(model.updateOne.mock.calls[0][2].arrayFilters).toEqual([
        { 'e.pendingStreamUid': 'u1', 'e.pendingStatus': 'awaiting_upload' },
      ]);
      expect(stream.deleteVideo).toHaveBeenCalledWith('u1');
    });

    it.each([
      [
        'a link still valid',
        {
          pendingStatus: 'awaiting_upload',
          pendingExpiresAt: new Date('2026-10-01T13:00:00Z'),
        },
      ],
      [
        'a video already processing',
        {
          pendingStatus: 'processing',
          pendingExpiresAt: new Date('2026-10-01T11:00:00Z'),
        },
      ],
    ])('leaves %s alone', async (_label, fields) => {
      const changed = await service.expireUnusedUpload(
        String(SERIES_ID),
        {
          seasonNumber: 1,
          episodeNumber: 1,
          pendingStreamUid: 'u1',
          ...fields,
        },
        now,
      );
      expect(changed).toBe(false);
      expect(model.updateOne).not.toHaveBeenCalled();
    });
  });
});
