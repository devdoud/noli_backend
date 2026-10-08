import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

// One phone able to receive pushes (spec 0008). A token belongs to one user
// at a time; a user keeps at most 10.
@Schema({ collection: 'devices', timestamps: true })
export class Device {
  _id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, unique: true, minlength: 1, maxlength: 4096 })
  token!: string;

  @Prop({ type: String, enum: DEVICE_PLATFORMS, required: true })
  platform!: DevicePlatform;

  @Prop({ type: String, default: null, maxlength: 32 })
  appVersion!: string | null;

  @Prop({ required: true })
  lastSeenAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const DeviceSchema = SchemaFactory.createForClass(Device);
DeviceSchema.index({ userId: 1, lastSeenAt: -1 });
