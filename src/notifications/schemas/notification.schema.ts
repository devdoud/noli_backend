import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export const NOTIFICATION_TYPES = [
  'new_episodes',
  'new_series',
  'premium_ending',
  'payment_succeeded',
  'payment_failed',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const CONTENT_TYPES: readonly NotificationType[] = [
  'new_episodes',
  'new_series',
];

// Delivery order (AC-8): account first, then episodes, then series.
export const TYPE_RANK: Record<NotificationType, number> = {
  premium_ending: 0,
  payment_succeeded: 0,
  payment_failed: 0,
  new_episodes: 1,
  new_series: 2,
};

export type PushStatus = 'pending' | 'sending' | 'sent' | 'skipped' | 'failed';

export interface NotificationData {
  seriesId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  count?: number;
  endDate?: string;
}

// The inbox and the dedupe log (spec 0008). Timestamps are managed by hand:
// createdAt never changes (it drives the 30 day expiry) while updatedAt moves
// when a grouped update lands (the inbox sorts on it).
@Schema({ collection: 'notifications' })
export class Notification {
  _id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: NOTIFICATION_TYPES, required: true })
  type!: NotificationType;

  @Prop({ required: true })
  typeRank!: number;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  body!: string;

  @Prop({ type: Object, default: {} })
  data!: NotificationData;

  @Prop({ required: true })
  dedupeKey!: string;

  @Prop({ type: [Types.ObjectId], default: [] })
  jobIds!: Types.ObjectId[];

  @Prop({ type: String, required: true, default: 'pending' })
  pushStatus!: PushStatus;

  @Prop({ type: String, default: null })
  skipReason!: string | null;

  @Prop({ required: true })
  sendAfter!: Date;

  @Prop({ default: 0 })
  pushAttempts!: number;

  @Prop({ type: Date, default: null })
  lockedAt!: Date | null;

  @Prop({ type: Date, default: null })
  readAt!: Date | null;

  @Prop({ required: true })
  createdAt!: Date;

  @Prop({ required: true })
  updatedAt!: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
NotificationSchema.index({ userId: 1, updatedAt: -1 });
NotificationSchema.index({ pushStatus: 1, typeRank: 1, sendAfter: 1 });
NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);
