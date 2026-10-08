import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

// Content pushes claimed per user and Lagos day of sending (AC-8). Claimed
// atomically by the push sender, so two instances can't exceed the cap.
@Schema({ collection: 'push_counters' })
export class PushCounter {
  @Prop({ type: Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  lagosDay!: string;

  @Prop({ default: 0 })
  count!: number;

  @Prop({ type: Date, default: () => new Date() })
  createdAt!: Date;
}

export const PushCounterSchema = SchemaFactory.createForClass(PushCounter);
PushCounterSchema.index({ userId: 1, lagosDay: 1 }, { unique: true });
PushCounterSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 2 * 24 * 60 * 60 },
);
