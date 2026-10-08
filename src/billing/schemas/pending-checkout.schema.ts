import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class PendingCheckout extends Document {
  @Prop({ required: true, unique: true })
  partnerId!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  expectedAmount!: number;

  @Prop({ type: Date, default: null })
  consumedAt!: Date | null;

  @Prop({ type: String, default: null })
  consumedByTransactionId!: string | null;

  createdAt?: Date;
}

export const PendingCheckoutSchema =
  SchemaFactory.createForClass(PendingCheckout);
