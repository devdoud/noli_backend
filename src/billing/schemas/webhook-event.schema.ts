import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type KkiapayEventType = 'transaction.success' | 'transaction.failed';
export type WebhookEventStatus = 'received' | 'processed' | 'failed';
export type WebhookEventOutcome =
  | 'credited'
  | 'rejected_failed'
  | 'rejected_mismatch'
  | 'no_pending_checkout'
  | 'verify_error';

@Schema({ timestamps: false })
export class WebhookEvent extends Document {
  @Prop({ required: true, unique: true })
  transactionId!: string;

  @Prop({ required: true, enum: ['transaction.success', 'transaction.failed'] })
  kkiapayEvent!: KkiapayEventType;

  @Prop({
    required: true,
    enum: ['received', 'processed', 'failed'],
    default: 'received',
  })
  status!: WebhookEventStatus;

  @Prop({
    enum: [
      'credited',
      'rejected_failed',
      'rejected_mismatch',
      'no_pending_checkout',
      'verify_error',
    ],
  })
  outcome?: WebhookEventOutcome;

  @Prop()
  partnerId?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  userId?: Types.ObjectId;

  @Prop()
  verifiedAmount?: number;

  @Prop()
  wasReactivation?: boolean;

  @Prop({ type: Object, required: true })
  payload!: Record<string, unknown>;

  @Prop({ required: true, default: Date.now })
  receivedAt!: Date;

  @Prop({ type: Date, default: null })
  processedAt!: Date | null;
}

export const WebhookEventSchema = SchemaFactory.createForClass(WebhookEvent);
