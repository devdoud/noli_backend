import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { StreamClient } from './stream.client';
import { StreamWebhookController } from './stream-webhook.controller';
import { VideoStateService } from './video-state.service';

// Real HTTP with rawBody enabled, as in main.ts (spec 0006 AC-5): the
// signature is checked against the exact bytes Cloudflare sent.
describe('POST /webhooks/cloudflare-stream over HTTP (spec 0006 AC-5)', () => {
  let app: INestApplication;
  const stream = {
    webhookSigningSecret: 'whsec' as string | undefined,
    env: 'development',
  };
  const videoState = {
    applyStreamState: jest.fn().mockResolvedValue('applied'),
  };

  const body = JSON.stringify({
    uid: 'vid1',
    readyToStream: true,
    status: { state: 'ready' },
    duration: 1400,
    meta: { env: 'development' },
  });
  const sign = (
    raw: string,
    time = Math.floor(Date.now() / 1000),
    secret = 'whsec',
  ) =>
    `time=${time},sig1=${createHmac('sha256', secret).update(`${time}.${raw}`).digest('hex')}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StreamWebhookController],
      providers: [
        { provide: StreamClient, useValue: stream },
        { provide: VideoStateService, useValue: videoState },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    stream.webhookSigningSecret = 'whsec';
  });

  it('accepts a correctly signed event and applies it with retries for an early delivery', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/cloudflare-stream')
      .set('Content-Type', 'application/json')
      .set('Webhook-Signature', sign(body))
      .send(body)
      .expect(200);

    expect(res.body).toEqual({ received: true });
    expect(videoState.applyStreamState).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'vid1', status: { state: 'ready' } }),
      { retryUnknown: true },
    );
  });

  it('refuses a body modified after signing', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/cloudflare-stream')
      .set('Content-Type', 'application/json')
      .set('Webhook-Signature', sign(body))
      .send(body.replace('1400', '1401'))
      .expect(401);
    expect(videoState.applyStreamState).not.toHaveBeenCalled();
  });

  it('refuses a missing signature and an old timestamp', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/cloudflare-stream')
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(401);
    const old = Math.floor(Date.now() / 1000) - 600;
    await request(app.getHttpServer())
      .post('/webhooks/cloudflare-stream')
      .set('Content-Type', 'application/json')
      .set('Webhook-Signature', sign(body, old))
      .send(body)
      .expect(401);
    expect(videoState.applyStreamState).not.toHaveBeenCalled();
  });

  it('answers 503 when the webhook secret is not configured (AC-15)', async () => {
    stream.webhookSigningSecret = undefined;
    await request(app.getHttpServer())
      .post('/webhooks/cloudflare-stream')
      .set('Content-Type', 'application/json')
      .set('Webhook-Signature', sign(body))
      .send(body)
      .expect(503);
  });
});
