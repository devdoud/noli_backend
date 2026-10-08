import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  })
  email!: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  })
  username!: string;

  @Prop({
    required: true,
    minlength: 6,
    select: false
  })
  password!: string;

  @Prop({ trim: true })
  firstName?: string;

  @Prop({ trim: true })
  lastName?: string;

  @Prop()
  avatar?: string;

  @Prop({ default: false })
  isEmailVerified!: boolean;

  // Carried in every token as `tv`; a password reset increments it, which
  // signs out every older session (spec 0007 AC-9). Missing reads as 0.
  @Prop({ default: 0 })
  tokenVersion!: number;

  // Push notification switches (spec 0008). Nothing is written by default:
  // a missing value means "on".
  @Prop({
    type: {
      newEpisodes: Boolean,
      newSeries: Boolean,
      premium: Boolean,
      payment: Boolean,
    },
    _id: false,
    default: undefined,
  })
  notificationPrefs?: {
    newEpisodes?: boolean;
    newSeries?: boolean;
    premium?: boolean;
    payment?: boolean;
  };

  @Prop({
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  })
  role!: 'user' | 'admin';

  @Prop({
    type: {
      plan: {
        type: String,
        enum: ['free', 'premium'],
        default: 'free'
      },
      startDate: { type: Date, default: Date.now },
      endDate: Date,
      isActive: { type: Boolean, default: true },
      lastTransactionId: String
    },
    default: {
      plan: 'free',
      isActive: true,
      startDate: new Date()
    }
  })
  subscription!: {
    plan: 'free' | 'premium';
    startDate: Date;
    endDate?: Date;
    isActive: boolean;
    lastTransactionId?: string;
  };

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);