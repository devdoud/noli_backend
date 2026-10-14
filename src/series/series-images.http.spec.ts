import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SeriesController } from './series.controller';
import { SeriesService } from './series.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadThrottlerGuard } from '../media/upload-throttler.guard';

// Real HTTP through the series image routes (spec 0005): Multer, ParseIntPipe,
// the inline admin check, and the response envelope all run for real. Only
// the JWT guard is stubbed (a test header carries the role) and the service is
// mocked at its boundary.
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
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

describe('Series image routes over HTTP (spec 0005)', () => {
  let app: INestApplication;
  const service = {
    setSeriesImage: jest.fn(),
    removeSeriesImage: jest.fn(),
    setEpisodeThumbnail: jest.fn(),
    removeEpisodeThumbnail: jest.fn(),
  };
  const stored = {
    _id: SERIES,
    title: 'S',
    coverImage: 'https://res.cloudinary.com/c/image/upload/f_auto,q_auto/v1/x',
    categoryIds: [{ _id: 'c1', name: 'Drame', slug: 'drame' }],
    episodes: [
      { seasonNumber: 1, episodeNumber: 1, title: 'E1', videoUrl: 'secret', duration: 60 },
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
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('uploads a cover as admin and returns { message, series } with populated categories and no videoUrl (AC-1)', async () => {
    service.setSeriesImage.mockResolvedValue(stored);

    const res = await request(app.getHttpServer())
      .put(`/series/${SERIES}/cover`)
      .set('x-test-role', 'admin')
      .attach('file', png, 'cover.png')
      .expect(200);

    expect(res.body.message).toBe('Series cover updated');
    expect(res.body.series.coverImage).toBe(stored.coverImage);
    expect(res.body.series.categories).toEqual([
      { _id: 'c1', name: 'Drame', slug: 'drame', isVisible: true },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('videoUrl');
    const [id, field, file] = service.setSeriesImage.mock.calls[0];
    expect([id, field]).toEqual([SERIES, 'coverImage']);
    expect(Buffer.compare(file.buffer, png)).toBe(0);
  });

  it('routes the banner to the banner field (AC-1)', async () => {
    service.setSeriesImage.mockResolvedValue(stored);

    await request(app.getHttpServer())
      .put(`/series/${SERIES}/banner`)
      .set('x-test-role', 'admin')
      .attach('file', png, 'banner.png')
      .expect(200);

    expect(service.setSeriesImage.mock.calls[0][1]).toBe('bannerImage');
  });

  it('answers 401 without a token (AC-10)', async () => {
    await request(app.getHttpServer())
      .put(`/series/${SERIES}/cover`)
      .attach('file', png, 'cover.png')
      .expect(401);
    expect(service.setSeriesImage).not.toHaveBeenCalled();
  });

  it('answers 403 to a viewer, without calling the service (AC-10)', async () => {
    await request(app.getHttpServer())
      .put(`/series/${SERIES}/cover`)
      .set('x-test-role', 'user')
      .attach('file', png, 'cover.png')
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/series/${SERIES}/episodes/1/1/thumbnail`)
      .set('x-test-role', 'user')
      .expect(403);
    expect(service.setSeriesImage).not.toHaveBeenCalled();
    expect(service.removeEpisodeThumbnail).not.toHaveBeenCalled();
  });

  it('refuses a file over 5 MB with 413 before reaching the service (AC-5)', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 1);

    await request(app.getHttpServer())
      .put(`/series/${SERIES}/cover`)
      .set('x-test-role', 'admin')
      .attach('file', big, 'big.png')
      .expect(413);
    expect(service.setSeriesImage).not.toHaveBeenCalled();
  });

  it('refuses a file sent under another field name with 400 (AC-5)', async () => {
    await request(app.getHttpServer())
      .put(`/series/${SERIES}/cover`)
      .set('x-test-role', 'admin')
      .attach('image', png, 'cover.png')
      .expect(400);
    expect(service.setSeriesImage).not.toHaveBeenCalled();
  });

  it('reads the file before the admin check, as the spec documents: a viewer over 5 MB gets 413 (accepted tradeoff)', async () => {
    await request(app.getHttpServer())
      .put(`/series/${SERIES}/cover`)
      .set('x-test-role', 'user')
      .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1, 1), 'big.png')
      .expect(413);
  });

  it('refuses a season or episode that is not a whole number with 400 (AC-10)', async () => {
    await request(app.getHttpServer())
      .delete(`/series/${SERIES}/episodes/x/1/thumbnail`)
      .set('x-test-role', 'admin')
      .expect(400);
    await request(app.getHttpServer())
      .put(`/series/${SERIES}/episodes/1/1.5/thumbnail`)
      .set('x-test-role', 'admin')
      .attach('file', png, 't.png')
      .expect(400);
    expect(service.removeEpisodeThumbnail).not.toHaveBeenCalled();
    expect(service.setEpisodeThumbnail).not.toHaveBeenCalled();
  });

  it('passes season and episode as numbers to the thumbnail service (AC-2)', async () => {
    service.setEpisodeThumbnail.mockResolvedValue(stored);

    const res = await request(app.getHttpServer())
      .put(`/series/${SERIES}/episodes/1/1/thumbnail`)
      .set('x-test-role', 'admin')
      .attach('file', png, 't.png')
      .expect(200);

    expect(res.body.message).toBe('Episode thumbnail updated');
    expect(service.setEpisodeThumbnail.mock.calls[0].slice(0, 3)).toEqual([SERIES, 1, 1]);
    expect(res.body.series.episodes[0].thumbnail).toBeNull();
  });

  it('removes a cover with DELETE and returns the series (AC-7)', async () => {
    service.removeSeriesImage.mockResolvedValue({ ...stored, coverImage: null });

    const res = await request(app.getHttpServer())
      .delete(`/series/${SERIES}/cover`)
      .set('x-test-role', 'admin')
      .expect(200);

    expect(res.body).toMatchObject({ message: 'Series cover removed', series: { coverImage: null } });
    expect(service.removeSeriesImage).toHaveBeenCalledWith(SERIES, 'coverImage');
  });
});
