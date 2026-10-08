import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CategoriesController } from './categories.controller';
import { CATEGORY_IN_USE, CategoriesService } from './categories.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadThrottlerGuard } from '../media/upload-throttler.guard';

// Spec 0003 over real HTTP: route order (static routes before :slug and
// :id), the global ValidationPipe with its whitelist, DTO rules, guards, and
// error bodies. The service is mocked; its logic has its own unit tests.
class FakeJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.headers['x-test-role'];
    if (!role) throw new UnauthorizedException();
    req.user = { _id: 'u1', role };
    return true;
  }
}

const ID = '65a1b2c3d4e5f6a7b8c9d0e1';
const ID2 = '65a1b2c3d4e5f6a7b8c9d0e2';

describe('Categories over HTTP (spec 0003)', () => {
  let app: INestApplication;
  const service = {
    listVisible: jest.fn().mockResolvedValue([]),
    listAll: jest.fn().mockResolvedValue([]),
    findVisibleBySlug: jest.fn().mockResolvedValue({ _id: ID, slug: 'drame' }),
    getSeriesInCategory: jest.fn().mockResolvedValue({ total: 0, page: 1, limit: 10, series: [] }),
    create: jest.fn().mockResolvedValue({ _id: ID, name: 'Drame', slug: 'drame' }),
    update: jest.fn().mockResolvedValue({ _id: ID }),
    reorder: jest.fn().mockResolvedValue([]),
    remove: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [{ provide: CategoriesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(FakeJwtGuard)
      .overrideGuard(UploadThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const http = () => request(app.getHttpServer());

  describe('route order', () => {
    it('GET /categories/all reaches the admin list, not the slug route (AC-5)', async () => {
      await http().get('/categories/all').set('x-test-role', 'admin').expect(200);
      expect(service.listAll).toHaveBeenCalled();
      expect(service.findVisibleBySlug).not.toHaveBeenCalled();
    });

    it('PUT /categories/order reaches reorder (AC-3)', async () => {
      await http().put('/categories/order').set('x-test-role', 'admin').send({ ids: [ID, ID2] }).expect(200);
      expect(service.reorder).toHaveBeenCalledWith({ ids: [ID, ID2] });
    });
  });

  describe('visibility and admin list (AC-5)', () => {
    it('the public list needs no token', async () => {
      await http().get('/categories').expect(200);
      expect(service.listVisible).toHaveBeenCalled();
    });

    it('/categories/all answers 401 without a token and 403 to a regular user', async () => {
      await http().get('/categories/all').expect(401);
      await http().get('/categories/all').set('x-test-role', 'user').expect(403);
      expect(service.listAll).not.toHaveBeenCalled();
    });

    it('an unknown or hidden slug answers 404', async () => {
      service.findVisibleBySlug.mockRejectedValueOnce(new NotFoundException('Category not found'));
      await http().get('/categories/hidden-one').expect(404);
    });
  });

  describe('create (AC-1)', () => {
    it('accepts a valid body and strips fields the client may not set', async () => {
      await http()
        .post('/categories')
        .set('x-test-role', 'admin')
        .send({ name: 'Comédie romantique', slug: 'forced', displayOrder: 0, nameKey: 'x' })
        .expect(201);
      expect(service.create).toHaveBeenCalledWith({ name: 'Comédie romantique' });
    });

    it.each([
      ['a missing name', {}],
      ['an empty name', { name: '' }],
      ['a name over 50 characters', { name: 'x'.repeat(51) }],
      ['a description over 300 characters', { name: 'Drame', description: 'x'.repeat(301) }],
      ['an invalid image URL', { name: 'Drame', imageUrl: 'not a url' }],
      ['a non boolean isVisible', { name: 'Drame', isVisible: 'yes' }],
    ])('refuses %s with 400', async (_label, body) => {
      await http().post('/categories').set('x-test-role', 'admin').send(body).expect(400);
      expect(service.create).not.toHaveBeenCalled();
    });

    it('refuses a regular user with 403', async () => {
      await http().post('/categories').set('x-test-role', 'user').send({ name: 'Drame' }).expect(403);
    });
  });

  describe('update (AC-2)', () => {
    const patch = (body: object) =>
      http().patch(`/categories/${ID}`).set('x-test-role', 'admin').send(body);

    it('lets description be cleared with null and strips displayOrder', async () => {
      await patch({ description: null, displayOrder: 3 }).expect(200);
      expect(service.update).toHaveBeenCalledWith(ID, { description: null });
    });

    it.each([
      ['a null name', { name: null }],
      ['a null isVisible', { isVisible: null }],
      ['a slug with capitals or spaces', { slug: 'Not A Slug' }],
      ['an empty name', { name: '' }],
    ])('refuses %s with 400', async (_label, body) => {
      await patch(body).expect(400);
      expect(service.update).not.toHaveBeenCalled();
    });
  });

  describe('reorder (AC-3)', () => {
    it.each([
      ['ids that is not a list', { ids: ID }],
      ['a repeated id', { ids: [ID, ID] }],
      ['an id that is not a Mongo id', { ids: [ID, 'nope'] }],
      ['no ids at all', {}],
    ])('refuses %s with 400', async (_label, body) => {
      await http().put('/categories/order').set('x-test-role', 'admin').send(body).expect(400);
      expect(service.reorder).not.toHaveBeenCalled();
    });
  });

  it('delete of a category in use answers 409 with code and seriesCount in the body (AC-4)', async () => {
    service.remove.mockRejectedValueOnce(
      new ConflictException({
        statusCode: 409,
        code: CATEGORY_IN_USE,
        message: 'Move or edit the series in this category before deleting it',
        seriesCount: 3,
      }),
    );

    const res = await http().delete(`/categories/${ID}`).set('x-test-role', 'admin').expect(409);

    expect(res.body).toMatchObject({ code: 'CATEGORY_IN_USE', seriesCount: 3 });
  });

  describe('series in a category (AC-6)', () => {
    it('converts page and limit to numbers and applies the defaults', async () => {
      await http().get('/categories/drame/series?page=2&limit=5&sort=rating').expect(200);
      expect(service.getSeriesInCategory).toHaveBeenCalledWith('drame', { page: 2, limit: 5, sort: 'rating' });

      await http().get('/categories/drame/series').expect(200);
      expect(service.getSeriesInCategory).toHaveBeenLastCalledWith('drame', {
        page: 1,
        limit: 10,
        sort: 'newest',
      });
    });

    it.each(['page=abc', 'page=0', 'limit=51', 'limit=0', 'sort=x'])(
      'refuses %s with 400',
      async (query) => {
        await http().get(`/categories/drame/series?${query}`).expect(400);
        expect(service.getSeriesInCategory).not.toHaveBeenCalled();
      },
    );
  });
});
