import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FcmClient, PushMessage } from './fcm.client';
import { DevicesService } from './devices.service';
import { NotificationsService } from './notifications.service';
import { lagosDay } from './lagos-time';
import { CONTENT_TYPES, Notification } from './schemas/notification.schema';
import { PushCounter } from './schemas/push-counter.schema';
import { testText } from './templates/fr';

const PUSHES_PER_RUN = 500;
const DAILY_CONTENT_CAP = 3; // AC-8
const MAX_PUSH_ATTEMPTS = 3; // AC-11
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // AC-11
const SENDING_LOCK_MS = 2 * 60 * 1000;

// Pushes due notifications (spec 0008). Each one is claimed ('sending')
// before the FCM call, so two instances never push the same one; content
// pushes also claim a daily cap slot.
@Injectable()
export class PushSender {
  private readonly logger = new Logger(PushSender.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @InjectModel(PushCounter.name)
    private readonly counterModel: Model<PushCounter>,
    private readonly fcm: FcmClient,
    private readonly devices: DevicesService,
    private readonly notifications: NotificationsService,
  ) {}

  async deliverDue(now: Date = new Date()): Promise<number> {
    await this.notificationModel.updateMany(
      {
        pushStatus: 'pending',
        createdAt: { $lt: new Date(now.getTime() - STALE_AFTER_MS) },
      },
      { $set: { pushStatus: 'failed', skipReason: 'stale' } },
    );
    await this.notificationModel.updateMany(
      {
        pushStatus: 'sending',
        lockedAt: { $lt: new Date(now.getTime() - SENDING_LOCK_MS) },
      },
      { $set: { pushStatus: 'pending', lockedAt: null } },
    );
    // AC-17: without credentials outside dev, pushes wait (then go stale).
    if (this.fcm.mode() === 'off') return 0;

    let sent = 0;
    for (let i = 0; i < PUSHES_PER_RUN; i++) {
      const claimed = await this.notificationModel
        .findOneAndUpdate(
          { pushStatus: 'pending', sendAfter: { $lte: now } },
          { $set: { pushStatus: 'sending', lockedAt: new Date() } },
          { sort: { typeRank: 1, sendAfter: 1 }, returnDocument: 'after' },
        )
        .lean<Notification>();
      if (!claimed) break;
      if (await this.deliverOne(claimed, now)) sent++;
    }
    return sent;
  }

  private async deliverOne(n: Notification, now: Date): Promise<boolean> {
    const content = CONTENT_TYPES.includes(n.type);
    const day = lagosDay(now);
    if (content && !(await this.claimCapSlot(n.userId, day))) {
      await this.finish(n, { pushStatus: 'skipped', skipReason: 'cap' });
      return false;
    }

    const tokens = await this.devices.tokensOf(n.userId);
    if (tokens.length === 0) {
      if (content) await this.releaseCapSlot(n.userId, day);
      await this.finish(n, { pushStatus: 'skipped', skipReason: 'no_device' });
      return false;
    }

    const badge = await this.notifications.unreadCount(n.userId);
    const outcomes = await this.fcm.send(
      n.userId.toString(),
      tokens,
      this.buildMessage(n, badge),
    );
    const invalid = tokens.filter((_, i) => outcomes[i] === 'invalid');
    await this.devices.deleteTokens(invalid);

    if (outcomes.includes('ok')) {
      await this.finish(n, { pushStatus: 'sent', skipReason: null });
      return true;
    }
    if (content) await this.releaseCapSlot(n.userId, day);
    if (!outcomes.includes('temporary')) {
      await this.finish(n, { pushStatus: 'skipped', skipReason: 'no_device' });
      return false;
    }
    const attempts = n.pushAttempts + 1;
    await this.finish(
      n,
      attempts >= MAX_PUSH_ATTEMPTS
        ? { pushStatus: 'failed', skipReason: 'fcm', pushAttempts: attempts }
        : { pushStatus: 'pending', pushAttempts: attempts },
    );
    return false;
  }

  // Conditional on still holding the claim, so a slow worker whose lock was
  // reset never overwrites a newer outcome.
  private async finish(
    n: Notification,
    fields: Partial<
      Pick<Notification, 'pushStatus' | 'skipReason' | 'pushAttempts'>
    >,
  ): Promise<void> {
    await this.notificationModel.updateOne(
      { _id: n._id, pushStatus: 'sending', lockedAt: n.lockedAt },
      { $set: { ...fields, lockedAt: null } },
    );
  }

  // AC-8: the slot is the counter going from below 3 to one more. When the
  // filter misses because the day already holds 3, the upsert collides with
  // the unique index: no slot.
  private async claimCapSlot(
    userId: Types.ObjectId,
    day: string,
  ): Promise<boolean> {
    try {
      await this.counterModel.findOneAndUpdate(
        { userId, lagosDay: day, count: { $lt: DAILY_CONTENT_CAP } },
        { $inc: { count: 1 }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
      return true;
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) return false;
      throw error;
    }
  }

  private async releaseCapSlot(
    userId: Types.ObjectId,
    day: string,
  ): Promise<void> {
    await this.counterModel.updateOne(
      { userId, lagosDay: day, count: { $gt: 0 } },
      { $inc: { count: -1 } },
    );
  }

  private buildMessage(n: Notification, badge: number): PushMessage {
    const data: Record<string, string> = {
      type: n.type,
      notificationId: n._id.toString(),
    };
    if (n.data?.seriesId) data.seriesId = n.data.seriesId;
    if (n.data?.seasonNumber !== undefined) {
      data.seasonNumber = String(n.data.seasonNumber);
    }
    if (n.data?.episodeNumber !== undefined) {
      data.episodeNumber = String(n.data.episodeNumber);
    }
    return {
      title: n.title,
      body: n.body,
      data,
      account: !CONTENT_TYPES.includes(n.type),
      collapseKey: n.dedupeKey,
      threadId: n.data?.seriesId,
      badge,
    };
  }

  // AC-15: a direct push to the caller's devices, not stored in the inbox.
  async sendTest(
    userId: Types.ObjectId,
  ): Promise<{ devices: number; sent: number; failed: number }> {
    const tokens = await this.devices.tokensOf(userId);
    const badge = await this.notifications.unreadCount(userId);
    const text = testText();
    const outcomes = await this.fcm.send(userId.toString(), tokens, {
      ...text,
      data: { type: 'test' },
      account: true,
      badge,
    });
    await this.devices.deleteTokens(
      tokens.filter((_, i) => outcomes[i] === 'invalid'),
    );
    const sent = outcomes.filter((o) => o === 'ok').length;
    this.logger.log(
      `Test push for user ${userId.toString()}: ${sent}/${tokens.length}`,
    );
    return { devices: tokens.length, sent, failed: tokens.length - sent };
  }
}
