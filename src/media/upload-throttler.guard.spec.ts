import {
  CanActivate,
  Controller,
  Delete,
  ExecutionContext,
  INestApplication,
  Injectable,
  Module,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MediaModule } from './media.module';
import { UploadThrottlerGuard } from './upload-throttler.guard';
import { throttlerOptions } from '../throttler.config';

// Stands in for JwtAuthGuard: the user id comes from a test header.
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = { _id: req.headers['x-user'] };
    return true;
  }
}

@Controller('a')
class RoutesA {
  @UseGuards(FakeAuthGuard, UploadThrottlerGuard)
  @Put('cover')
  cover() {
    return { ok: true };
  }
}

@Controller('b')
class RoutesB {
  @UseGuards(FakeAuthGuard, UploadThrottlerGuard)
  @Delete('image')
  image() {
    return { ok: true };
  }
}

// A host module importing MediaModule, like SeriesModule and UsersModule:
// proves the guard resolves there with the shared store.
@Module({ imports: [MediaModule], controllers: [RoutesA, RoutesB] })
class HostModule {}

describe('UploadThrottlerGuard (spec 0005 AC-11)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        // As in AppModule: every named throttler, the password ones included.
        ThrottlerModule.forRoot(throttlerOptions),
        HostModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('shares one counter per user across every image route: the 11th call is 429', async () => {
    const http = request(app.getHttpServer());
    for (let i = 0; i < 5; i++) {
      await http.put('/a/cover').set('x-user', 'u1').expect(200);
      await http.delete('/b/image').set('x-user', 'u1').expect(200);
    }
    await http.put('/a/cover').set('x-user', 'u1').expect(429);
    await http.delete('/b/image').set('x-user', 'u1').expect(429);
  });

  it('counts per user, not per IP', async () => {
    const http = request(app.getHttpServer());
    for (let i = 0; i < 10; i++) {
      await http.put('/a/cover').set('x-user', 'u1').expect(200);
    }
    await http.put('/a/cover').set('x-user', 'u1').expect(429);
    await http.put('/a/cover').set('x-user', 'u2').expect(200);
  });

  // Spec 0007 AC-13: the password reset throttlers (20 and 30 per hour per
  // IP) never apply to image routes, and the image limit stays 10 per user.
  it('ignores the password reset throttlers', async () => {
    const http = request(app.getHttpServer());
    for (let u = 0; u < 4; u++) {
      for (let i = 0; i < 10; i++) {
        await http.put('/a/cover').set('x-user', `user${u}`).expect(200);
      }
    }
    await http.put('/a/cover').set('x-user', 'user0').expect(429);
  });
});
