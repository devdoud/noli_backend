import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Series, SeriesSchema } from './schemas/series.schema';
import { SeriesService } from './series.service';
import { SeriesController } from './series.controller';
import { CategoriesModule } from '../categories/categories.module';
import { WatchHistoryModule } from '../watch-history/watch-history.module';
import { MediaModule } from '../media/media.module';
import { VideoModule } from '../video/video.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Series.name, schema: SeriesSchema }]),
    CategoriesModule,
    WatchHistoryModule,
    MediaModule,
    VideoModule,
    NotificationsModule,
  ],
  providers: [SeriesService],
  controllers: [SeriesController],
  exports: [SeriesService],
})
export class SeriesModule {}
