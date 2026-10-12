import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { corsOptions, parseCorsOrigins, swaggerEnabled } from './http-config';

@Controller()
class PingController {
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

async function appWith(origins: string[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [PingController],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  if (origins.length > 0) app.enableCors(corsOptions(origins));
  await app.init();
  return app;
}

describe('HTTP switches (spec 0009)', () => {
  describe('parseCorsOrigins', () => {
    it('splits, trims, and drops empty entries', () => {
      expect(
        parseCorsOrigins(
          ' https://admin.nollli.com , http://localhost:5173,, ',
        ),
      ).toEqual(['https://admin.nollli.com', 'http://localhost:5173']);
    });

    it('gives an empty list when unset or blank', () => {
      expect(parseCorsOrigins(undefined)).toEqual([]);
      expect(parseCorsOrigins('  ')).toEqual([]);
    });
  });

  describe('swaggerEnabled (AC-8)', () => {
    it.each([
      [undefined, true],
      ['', true],
      ['true', true],
      ['false', false],
      [' FALSE ', false],
    ])('%p → %p', (raw, expected) => {
      expect(swaggerEnabled(raw)).toBe(expected);
    });
  });

  describe('CORS over HTTP (AC-7)', () => {
    let app: INestApplication;
    afterEach(async () => {
      await app.close();
    });

    it('answers a preflight from a listed origin with that origin, methods and headers', async () => {
      app = await appWith([
        'https://admin.nollli.com',
        'http://localhost:5173',
      ]);
      const res = await request(app.getHttpServer())
        .options('/ping')
        .set('Origin', 'https://admin.nollli.com')
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'Authorization, Content-Type');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(
        'https://admin.nollli.com',
      );
      expect(res.headers['access-control-allow-methods']).toBe(
        'GET,POST,PUT,PATCH,DELETE',
      );
      expect(res.headers['access-control-allow-headers']).toBe(
        'Authorization,Content-Type',
      );
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('gives no CORS header to an origin outside the list', async () => {
      app = await appWith(['https://admin.nollli.com']);
      const res = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', 'https://evil.example');
      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('sends no CORS header at all when no origin is configured', async () => {
      app = await appWith(parseCorsOrigins(''));
      const res = await request(app.getHttpServer())
        .get('/ping')
        .set('Origin', 'https://admin.nollli.com');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
