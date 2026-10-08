import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import {
  Notification,
  NotificationData,
  NotificationType,
  TYPE_RANK,
} from './schemas/notification.schema';

export const PREF_KEYS = [
  'newEpisodes',
  'newSeries',
  'premium',
  'payment',
] as const;
export type PrefKey = (typeof PREF_KEYS)[number];
export type NotificationPrefs = Record<PrefKey, boolean>;

export const PREF_FOR_TYPE: Record<NotificationType, PrefKey> = {
  new_episodes: 'newEpisodes',
  new_series: 'newSeries',
  premium_ending: 'premium',
  payment_succeeded: 'payment',
  payment_failed: 'payment',
};

// A missing switch means "on" (AC-3).
export function resolvePrefs(
  stored?: Partial<Record<PrefKey, boolean>> | null,
): NotificationPrefs {
  return {
    newEpisodes: stored?.newEpisodes !== false,
    newSeries: stored?.newSeries !== false,
    premium: stored?.premium !== false,
    payment: stored?.payment !== false,
  };
}

export interface PublicNotification {
  _id: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  data: NotificationData;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DirectNotification {
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  data?: NotificationData;
  dedupeKey: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async getPrefs(userId: Types.ObjectId): Promise<NotificationPrefs> {
    const user = await this.userModel
      .findById(userId)
      .select('notificationPrefs')
      .lean();
    return resolvePrefs(user?.notificationPrefs);
  }

  // AC-3: only the four known switches; nothing left after the whitelist
  // (empty body, or unknown fields only) is a 400.
  async updatePrefs(
    userId: Types.ObjectId,
    input: Partial<Record<PrefKey, boolean>>,
  ): Promise<NotificationPrefs> {
    const $set: Record<string, boolean> = {};
    for (const key of PREF_KEYS) {
      if (typeof input[key] === 'boolean') {
        $set[`notificationPrefs.${key}`] = input[key];
      }
    }
    if (Object.keys($set).length === 0) {
      throw new BadRequestException(
        'Send at least one of newEpisodes, newSeries, premium, payment',
      );
    }
    const user = await this.userModel
      .findByIdAndUpdate(userId, { $set }, { returnDocument: 'after' })
      .select('notificationPrefs')
      .lean();
    return resolvePrefs(user?.notificationPrefs);
  }

  // AC-12: the caller's inbox, most recently updated first.
  async list(
    userId: Types.ObjectId,
    page: number,
    limit: number,
  ): Promise<{
    total: number;
    unread: number;
    notifications: PublicNotification[];
  }> {
    const [total, unread, items] = await Promise.all([
      this.notificationModel.countDocuments({ userId }),
      this.unreadCount(userId),
      this.notificationModel
        .find({ userId })
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    return { total, unread, notifications: items.map(toPublicNotification) };
  }

  unreadCount(userId: Types.ObjectId): Promise<number> {
    return this.notificationModel.countDocuments({ userId, readAt: null });
  }

  async markRead(
    userId: Types.ObjectId,
    id: string,
  ): Promise<PublicNotification> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Notification not found');
    }
    const updated =
      (await this.notificationModel
        .findOneAndUpdate(
          { _id: id, userId, readAt: null },
          { $set: { readAt: new Date() } },
          { returnDocument: 'after' },
        )
        .lean()) ??
      (await this.notificationModel.findOne({ _id: id, userId }).lean());
    if (!updated) {
      throw new NotFoundException('Notification not found');
    }
    return toPublicNotification(updated);
  }

  async markAllRead(userId: Types.ObjectId): Promise<number> {
    const res = await this.notificationModel.updateMany(
      { userId, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return res.modifiedCount;
  }

  // A single recipient notification (payments, premium). Pushed right away,
  // never capped. Returns false when the user turned the type off or the
  // notification already exists (its dedupe key makes retries harmless).
  async createDirect(
    input: DirectNotification,
    options: { prefsChecked?: boolean } = {},
  ): Promise<boolean> {
    if (!options.prefsChecked) {
      const prefs = await this.getPrefs(input.userId);
      if (!prefs[PREF_FOR_TYPE[input.type]]) return false;
    }
    const now = new Date();
    try {
      await this.notificationModel.create({
        userId: input.userId,
        type: input.type,
        typeRank: TYPE_RANK[input.type],
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        dedupeKey: input.dedupeKey,
        jobIds: [],
        pushStatus: 'pending',
        sendAfter: now,
        createdAt: now,
        updatedAt: now,
      });
      return true;
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) return false;
      throw error;
    }
  }
}

export function toPublicNotification(n: Notification): PublicNotification {
  return {
    _id: n._id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data ?? {},
    readAt: n.readAt ?? null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}
