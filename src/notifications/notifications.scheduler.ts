import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { NotificationProcessor } from './notification-processor';
import { PushSender } from './push-sender';
import { NotificationsService } from './notifications.service';
import { lagosDay, lagosDayRange, lagosHour } from './lagos-time';
import { premiumEndingText } from './templates/fr';

const PREMIUM_REMINDER_HOUR = 9; // AC-6, Lagos time

// The two crons of spec 0008. Each run is safe across instances (jobs and
// pushes are claimed, premium reminders are deduped by key); the flag only
// avoids overlapping runs inside one process.
@Injectable()
export class NotificationsScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsScheduler.name);
  private running = false;

  constructor(
    private readonly processor: NotificationProcessor,
    private readonly sender: PushSender,
    private readonly notifications: NotificationsService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processor.processDueJobs();
      await this.sender.deliverDue();
    } catch (error) {
      this.logger.error(
        `Notification run failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  @Cron('0 9 * * *', { timeZone: 'Africa/Lagos' })
  async premiumCron(): Promise<void> {
    await this.sendPremiumReminders();
  }

  // AC-6: a restart after 09:00 catches up that day's reminders (the dedupe
  // keys make a second run add nothing).
  onApplicationBootstrap(): void {
    if (lagosHour(new Date()) >= PREMIUM_REMINDER_HOUR) {
      void this.sendPremiumReminders().catch((error: unknown) => {
        this.logger.error(
          `Premium reminder catch up failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
    }
  }

  async sendPremiumReminders(now: Date = new Date()): Promise<number> {
    let created = 0;
    for (const [daysAhead, reminder] of [
      [3, 'd3'],
      [0, 'd0'],
    ] as const) {
      const { start, end } = lagosDayRange(now, daysAhead);
      const users = await this.userModel
        .find({
          'subscription.plan': 'premium',
          'subscription.isActive': true,
          'subscription.endDate': { $gte: start, $lt: end },
          'notificationPrefs.premium': { $ne: false },
        })
        .select('_id subscription.endDate')
        .lean();
      const text = premiumEndingText(reminder);
      for (const user of users) {
        const endDate = user.subscription.endDate!;
        const ok = await this.notifications.createDirect(
          {
            userId: user._id,
            type: 'premium_ending',
            ...text,
            data: { endDate: endDate.toISOString() },
            dedupeKey: `premium_ending:${lagosDay(endDate)}:${reminder}`,
          },
          { prefsChecked: true },
        );
        if (ok) created++;
      }
    }
    if (created > 0) {
      this.logger.log(`Premium reminders created: ${created}`);
    }
    return created;
  }
}
