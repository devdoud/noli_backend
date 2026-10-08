import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WatchHistoryService } from './watch-history.service';
import { WatchHistoryController } from './watch-history.controller';
import {
  WatchHistory,
  WatchHistorySchema,
} from './schemas/watch-history.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WatchHistory.name, schema: WatchHistorySchema },
    ]),
  ],
  controllers: [WatchHistoryController],
  providers: [WatchHistoryService],
  exports: [WatchHistoryService],
})
export class WatchHistoryModule {}
