import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { KkiapayService } from './kkiapay.service';
import { BillingGraceScheduler } from './billing-grace.scheduler';
import {
  PendingCheckout,
  PendingCheckoutSchema,
} from './schemas/pending-checkout.schema';
import {
  WebhookEvent,
  WebhookEventSchema,
} from './schemas/webhook-event.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PendingCheckout.name, schema: PendingCheckoutSchema },
      { name: WebhookEvent.name, schema: WebhookEventSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, KkiapayService, BillingGraceScheduler],
  exports: [BillingService],
})
export class BillingModule {}
