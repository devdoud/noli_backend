import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RawBodyRequest } from '@nestjs/common';
import { StreamClient, StreamVideo } from './stream.client';
import { verifyStreamSignature } from './stream-webhook.verifier';
import { VideoStateService } from './video-state.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class StreamWebhookController {
  constructor(
    private readonly stream: StreamClient,
    private readonly videoState: VideoStateService,
  ) {}

  @ApiOperation({
    summary: 'Webhook Cloudflare Stream (fin de traitement d’une vidéo)',
    description:
      'Appelé par Cloudflare quand une vidéo est prête ou en erreur. Signé (en-tête Webhook-Signature, HMAC SHA256 du corps brut). Pas destiné aux clients.',
  })
  @ApiHeader({ name: 'Webhook-Signature', required: true })
  @ApiResponse({ status: 200, description: 'Événement reçu' })
  @ApiResponse({
    status: 401,
    description: 'Signature absente, invalide ou trop ancienne',
  })
  @ApiResponse({ status: 503, description: 'Secret du webhook non configuré' })
  @HttpCode(200)
  @Post('cloudflare-stream')
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('webhook-signature') signature: string | undefined,
  ) {
    const secret = this.stream.webhookSigningSecret;
    if (!secret) {
      throw new ServiceUnavailableException('Webhook vidéo non configuré');
    }
    if (!verifyStreamSignature(signature, req.rawBody, secret)) {
      throw new UnauthorizedException('Signature invalide');
    }
    const video = req.body as StreamVideo;
    if (video?.uid) {
      await this.videoState.applyStreamState(video, { retryUnknown: true });
    }
    return { received: true };
  }
}
