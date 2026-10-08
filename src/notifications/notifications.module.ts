import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Device, DeviceSchema } from './schemas/device.schema';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import {
  NotificationJob,
  NotificationJobSchema,
} from './schemas/notification-job.schema';
import { PushCounter, PushCounterSchema } from './schemas/push-counter.schema';
import { Series, SeriesSchema } from '../series/schemas/series.schema';
import {
  WatchHistory,
  WatchHistorySchema,
} from '../watch-history/schemas/watch-history.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  Category,
  CategorySchema,
} from '../categories/schemas/category.schema';
import { FcmClient } from './fcm.client';
import { DevicesService } from './devices.service';
import { NotificationsService } from './notifications.service';
import { NotificationQueue } from './notification-queue';
import { NotificationProcessor } from './notification-processor';
import { PushSender } from './push-sender';
import { NotificationsScheduler } from './notifications.scheduler';
import { NotificationsController } from './notifications.controller';

// Push notifications (spec 0008). Series, video, billing and auth import it
// for one call each; it reads their collections through its own models and
// never imports their modules, so there is no cycle.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Device.name, schema: DeviceSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: NotificationJob.name, schema: NotificationJobSchema },
      { name: PushCounter.name, schema: PushCounterSchema },
      { name: Series.name, schema: SeriesSchema },
      { name: WatchHistory.name, schema: WatchHistorySchema },
      { name: User.name, schema: UserSchema },
      { name: Category.name, schema: CategorySchema },
    ]),
  ],
  providers: [
    FcmClient,
    DevicesService,
    NotificationsService,
    NotificationQueue,
    NotificationProcessor,
    PushSender,
    NotificationsScheduler,
  ],
  controllers: [NotificationsController],
  exports: [NotificationQueue, NotificationsService, DevicesService],
})
export class NotificationsModule {}
