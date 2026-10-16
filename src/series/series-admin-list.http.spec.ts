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

// GET /series/admin over real HTTP (dashboard spec 0009, AC-11): the global
// ValidationPipe (whitelist, transform) turns the query into the DTO the
// service receives. The service is mocked; its filter has unit tests.
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.headers['x-test-role'];
    if (!role) throw new UnauthorizedException();
    req.user = { _id: 'u1', role };
    return true;
  }
}

const CAT = '65a1b2c3d4e5f6a7b8c9d0e2';
const HIDDEN = '65a1b2c3d4e5f6a7b8c9d0e3';
const listed = {
  _id: '65a1b2c3d4e5f6a7b8c9d0e1',
  title: 'Le Secret',
  isPremium: true,
  categoryIds: [
    { _id: CAT, name: 'Drame', slug: 'drame', isVisible: true },
    { _id: HIDDEN, name: 'Bientôt', slug: 'bientot', isVisible: false },
  ],
};

describe('GET /series/admin over HTTP (dashboard spec 0009)', () => {
  let app: INestApplication;
  const service = {
    listForAdmin: jest.fn(),
    getSeriesById: jest.fn(),
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service.listForAdmin.mockResolvedValue({
      total: 1,
      page: 1,
      limit: 20,
      series: [listed],
    });
  });

  const http = () => request(app.getHttpServer());
  const admin = (r: request.Test) => r.set('x-test-role', 'admin');

  it('defaults to page 1 and 20 per page, without filters', async () => {
    const res = await admin(http().get('/series/admin'));

    expect(res.status).toBe(200);
    expect(service.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
    );
    const query = service.listForAdmin.mock.calls[0][0];
    expect(query.q).toBeUndefined();
    expect(query.categoryId).toBeUndefined();
    expect(query.premium).toBeUndefined();
    expect(service.getSeriesById).not.toHaveBeenCalled();
  });

  it('passes every filter, converted and with the search text normalized', async () => {
    await admin(
      http().get('/series/admin').query({
        page: '2',
        limit: '50',
        q: '  le   secret ',
        categoryId: HIDDEN,
        premium: 'false',
      }),
    );

    expect(service.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 2,
        limit: 50,
        q: 'le secret',
        categoryId: HIDDEN,
        premium: 'false',
      }),
    );
  });

  it('answers with the admin shape: hidden categories with isVisible, no categoryIds', async () => {
    const res = await admin(http().get('/series/admin'));

    expect(res.body.data).toMatchObject({ total: 1, page: 1, limit: 20 });
    const [series] = res.body.data.series;
    expect(series.categoryIds).toBeUndefined();
    expect(series.categories).toEqual([
      { _id: CAT, name: 'Drame', slug: 'drame', isVisible: true },
      { _id: HIDDEN, name: 'Bientôt', slug: 'bientot', isVisible: false },
    ]);
  });

  it.each([
    ['limit above 50', { limit: '51' }],
    ['limit 0', { limit: '0' }],
    ['page 0', { page: '0' }],
    ['page not a number', { page: 'deux' }],
    ['search of one character', { q: 'a' }],
    ['search of one character after trimming', { q: '  a  ' }],
    ['search over 100 characters', { q: 'a'.repeat(101) }],
    ['category that is not an id', { categoryId: 'drame' }],
    ['premium other than true or false', { premium: 'yes' }],
  ])('refuses a %s with 400', async (_label, query) => {
    const res = await admin(http().get('/series/admin').query(query));

    expect(res.status).toBe(400);
    expect(service.listForAdmin).not.toHaveBeenCalled();
  });

  it('accepts a search of exactly 100 characters', async () => {
    const res = await admin(
      http()
        .get('/series/admin')
        .query({ q: 'a'.repeat(100) }),
    );
    expect(res.status).toBe(200);
  });

  it('passes premium=true unchanged for premium series only', async () => {
    const res = await admin(
      http().get('/series/admin').query({ premium: 'true' }),
    );

    expect(res.status).toBe(200);
    expect(service.listForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ premium: 'true' }),
    );
  });

  it('refuses an empty or blank search with 400 (the dashboard omits q instead)', async () => {
    const empty = await admin(http().get('/series/admin').query({ q: '' }));
    const blank = await admin(http().get('/series/admin').query({ q: '   ' }));

    expect(empty.status).toBe(400);
    expect(blank.status).toBe(400);
    expect(service.listForAdmin).not.toHaveBeenCalled();
  });

  it('refuses a viewer with 403 and an anonymous caller with 401', async () => {
    const viewer = await http().get('/series/admin').set('x-test-role', 'user');
    const anonymous = await http().get('/series/admin');

    expect(viewer.status).toBe(403);
    expect(anonymous.status).toBe(401);
    expect(service.listForAdmin).not.toHaveBeenCalled();
  });
});
