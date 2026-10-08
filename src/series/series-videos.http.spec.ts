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

// Real HTTP through the video routes (spec 0006): the global ValidationPipe
// of main.ts, ParseIntPipe, the admin check, and the admin response shape.
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.headers['x-test-role'];
    if (!role) throw new UnauthorizedException();
    req.user = { _id: 'u1', role };
    return true;
  }
}

const SERIES = '65a1b2c3d4e5f6a7b8c9d0e1';
const base = `/series/${SERIES}/episodes/1/1/video`;

describe('Episode video routes over HTTP (spec 0006)', () => {
  let app: INestApplication;
  const service = {
    requestVideoUpload: jest.fn(),
    importVideo: jest.fn(),
    refreshVideo: jest.fn(),
    removeVideo: jest.fn(),
    getSeriesForAdmin: jest.fn(),
  };
  const stored = {
    _id: SERIES,
    title: 'S',
    categoryIds: [],
    episodes: [
      { seasonNumber: 1, episodeNumber: 1, title: 'E1', duration: 60, pendingStreamUid: 'p1', pendingStatus: 'processing' },
      { seasonNumber: 1, episodeNumber: 2, title: 'E2', duration: 60, streamUid: 'cf2' },
    ],
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
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('returns an upload ticket to an admin (AC-1)', async () => {
    const expiresAt = new Date('2026-10-01T18:00:00Z');
    service.requestVideoUpload.mockResolvedValue({
      method: 'post',
      uploadUrl: 'https://up/u1',
      uid: 'u1',
      expiresAt,
    });

    const res = await request(app.getHttpServer())
      .post(`${base}/upload`)
      .set('x-test-role', 'admin')
      .send({ uploadLength: 157286400 })
      .expect(201);

    expect(res.body).toMatchObject({ method: 'post', uploadUrl: 'https://up/u1', uid: 'u1' });
    expect(service.requestVideoUpload).toHaveBeenCalledWith(SERIES, 1, 1, 157286400);
  });

  it.each([
    ['missing', {}],
    ['zero', { uploadLength: 0 }],
    ['not an integer', { uploadLength: 1.5 }],
    ['above 30 GB', { uploadLength: 30 * 1024 ** 3 + 1 }],
  ])('refuses an uploadLength that is %s with 400 (AC-14)', async (_label, body) => {
    await request(app.getHttpServer())
      .post(`${base}/upload`)
      .set('x-test-role', 'admin')
      .send(body)
      .expect(400);
    expect(service.requestVideoUpload).not.toHaveBeenCalled();
  });

  it('refuses an import link that is not https (AC-14)', async () => {
    await request(app.getHttpServer())
      .post(`${base}/import`)
      .set('x-test-role', 'admin')
      .send({ url: 'http://cdn.example.com/x.mp4' })
      .expect(400);
    expect(service.importVideo).not.toHaveBeenCalled();
  });

  it('starts an import from an https link (AC-2)', async () => {
    service.importVideo.mockResolvedValue({ uid: 'c1', pendingStatus: 'processing' });
    const res = await request(app.getHttpServer())
      .post(`${base}/import`)
      .set('x-test-role', 'admin')
      .send({ url: 'https://cdn.example.com/x.mp4' })
      .expect(201);
    expect(res.body).toMatchObject({ uid: 'c1', pendingStatus: 'processing' });
  });

  it('answers 401 without a token and 403 to a viewer, on every video route (AC-14)', async () => {
    await request(app.getHttpServer()).post(`${base}/refresh`).expect(401);
    for (const [method, path] of [
      ['post', `${base}/upload`],
      ['post', `${base}/import`],
      ['post', `${base}/refresh`],
      ['delete', base],
      ['get', `/series/${SERIES}/admin`],
    ] as const) {
      const body = path.endsWith('upload')
        ? { uploadLength: 10 }
        : path.endsWith('import')
          ? { url: 'https://x.com/a.mp4' }
          : undefined;
      await request(app.getHttpServer())[method](path).set('x-test-role', 'user').send(body).expect(403);
    }
    expect(Object.values(service).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('refuses a season that is not a whole number with 400 (AC-14)', async () => {
    await request(app.getHttpServer())
      .delete(`/series/${SERIES}/episodes/x/1/video`)
      .set('x-test-role', 'admin')
      .expect(400);
  });

  it('the admin view shows every episode with its video status and no internal ids leak as fields (AC-10)', async () => {
    service.getSeriesForAdmin.mockResolvedValue(stored);

    const res = await request(app.getHttpServer())
      .get(`/series/${SERIES}/admin`)
      .set('x-test-role', 'admin')
      .expect(200);

    const episodes = res.body.series.episodes;
    expect(episodes).toHaveLength(2);
    expect(episodes[0].video).toMatchObject({ status: 'pending', pendingStreamUid: 'p1' });
    expect(episodes[1].video).toMatchObject({ status: 'ready', streamUid: 'cf2' });
    expect(episodes[0]).not.toHaveProperty('pendingStreamUid');
    expect(episodes[1]).not.toHaveProperty('streamUid');
  });

  it('removing a video answers with the admin shape (AC-12)', async () => {
    service.removeVideo.mockResolvedValue(stored);
    const res = await request(app.getHttpServer())
      .delete(base)
      .set('x-test-role', 'admin')
      .expect(200);
    expect(res.body.message).toBe('Episode video removed');
    expect(res.body.series.episodes[0]).toHaveProperty('video');
  });
});
