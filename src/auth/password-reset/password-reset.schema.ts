import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export type PasswordResetStatus = 'pending' | 'verified' | 'used' | 'cancelled';

// One forgot password request (spec 0007). The code and the reset token are
// stored only as HMACs. Records delete themselves 24 hours after creation,
// which is also the longest window any limit looks back on.
@Schema({ collection: 'password_resets', timestamps: true })
export class PasswordReset {
  _id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  codeHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ default: 0 })
  attempts!: number;

  @Prop({
    type: String,
    enum: ['pending', 'verified', 'used', 'cancelled'],
    default: 'pending',
  })
  status!: PasswordResetStatus;

  @Prop({ type: Date, default: null })
  verifiedAt!: Date | null;

  @Prop({ type: String, default: undefined })
  resetTokenHash?: string;

  @Prop({ type: Date, default: null })
  resetTokenExpiresAt!: Date | null;

  @Prop({ type: Date, default: null })
  usedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PasswordResetSchema = SchemaFactory.createForClass(PasswordReset);

// Latest request of a user, and the per account limit counts.
PasswordResetSchema.index({ userId: 1, createdAt: -1 });
// Self cleanup after 24 hours; also serves the global daily cap count.
PasswordResetSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86_400 });
// Reset token lookup. Sparse: only verified requests carry one.
PasswordResetSchema.index(
  { resetTokenHash: 1 },
  { unique: true, sparse: true },
);
