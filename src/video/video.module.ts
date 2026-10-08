import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Series, SeriesSchema } from '../series/schemas/series.schema';
import { StreamClient } from './stream.client';
import { StreamWebhookController } from './stream-webhook.controller';
import { VideoStateService } from './video-state.service';
import { NotificationsModule } from '../notifications/notifications.module';

// Cloudflare Stream (spec 0006). SeriesModule imports it for uploads,
// playback, and cascades; the webhook lives here.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Series.name, schema: SeriesSchema }]),
    NotificationsModule,
  ],
  providers: [StreamClient, VideoStateService],
  controllers: [StreamWebhookController],
  exports: [StreamClient, VideoStateService],
})
export class VideoModule {}
