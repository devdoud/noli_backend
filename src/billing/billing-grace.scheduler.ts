import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { BILLING_GRACE_PERIOD_MS } from './billing.constants';

@Injectable()
export class BillingGraceScheduler {
  private readonly logger = new Logger(BillingGraceScheduler.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  // Single atomic updateMany (AC-3): the filter itself is the "still lapsed" check,
  // so a renewal that already pushed endDate forward falls outside it on its own.
  // No separate read-then-write, so a concurrently landing renewal is never clobbered.
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async downgradeLapsedSubscriptions(): Promise<void> {
    const cutoff = new Date(Date.now() - BILLING_GRACE_PERIOD_MS);

    const result = await this.userModel.updateMany(
      {
        'subscription.isActive': true,
        'subscription.endDate': { $lt: cutoff },
      },
      {
        $set: {
          'subscription.plan': 'free',
          'subscription.isActive': false,
        },
      },
    );

    if (result.modifiedCount > 0) {
      this.logger.log(
        `Grace period check downgraded ${result.modifiedCount} lapsed subscription(s)`,
      );
    }
  }
}
