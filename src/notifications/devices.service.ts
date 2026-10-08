import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Device, DevicePlatform } from './schemas/device.schema';

const MAX_DEVICES_PER_USER = 10;

export interface PublicDevice {
  token: string;
  platform: DevicePlatform;
  appVersion: string | null;
  lastSeenAt: Date;
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number })?.code === 11000;
}

@Injectable()
export class DevicesService {
  constructor(
    @InjectModel(Device.name) private readonly deviceModel: Model<Device>,
  ) {}

  // AC-1: upsert on the unique token (a token seen on another account moves
  // to the caller), then keep only the 10 most recent devices, never
  // removing the one just registered.
  async register(
    userId: Types.ObjectId,
    input: { token: string; platform: DevicePlatform; appVersion?: string },
  ): Promise<PublicDevice> {
    const upsert = () =>
      this.deviceModel
        .findOneAndUpdate(
          { token: input.token },
          {
            $set: {
              userId,
              platform: input.platform,
              appVersion: input.appVersion ?? null,
              lastSeenAt: new Date(),
            },
          },
          { upsert: true, returnDocument: 'after' },
        )
        .lean();

    let device: Device | null;
    try {
      device = await upsert();
    } catch (error) {
      // Two concurrent first registrations of the same token: the loser
      // retries and finds the winner's document.
      if (!isDuplicateKey(error)) throw error;
      device = await upsert();
    }

    const extra = await this.deviceModel
      .find({ userId, token: { $ne: input.token } })
      .sort({ lastSeenAt: -1 })
      .skip(MAX_DEVICES_PER_USER - 1)
      .select('_id')
      .lean();
    if (extra.length > 0) {
      await this.deviceModel.deleteMany({
        _id: { $in: extra.map((d) => d._id) },
      });
    }

    return toPublicDevice(device);
  }

  // AC-2: only the caller's own device; silent when absent.
  async unregister(userId: Types.ObjectId, token: string): Promise<void> {
    await this.deviceModel.deleteOne({ userId, token });
  }

  // AC-16: called after a password reset.
  async removeAllForUser(userId: Types.ObjectId): Promise<number> {
    const res = await this.deviceModel.deleteMany({ userId });
    return res.deletedCount;
  }

  async tokensOf(userId: Types.ObjectId): Promise<string[]> {
    const devices = await this.deviceModel
      .find({ userId })
      .select('token')
      .lean();
    return devices.map((d) => d.token);
  }

  // AC-11: tokens FCM reported as dead.
  async deleteTokens(tokens: string[]): Promise<void> {
    if (tokens.length > 0) {
      await this.deviceModel.deleteMany({ token: { $in: tokens } });
    }
  }
}

function toPublicDevice(device: Device): PublicDevice {
  return {
    token: device.token,
    platform: device.platform,
    appVersion: device.appVersion ?? null,
    lastSeenAt: device.lastSeenAt,
  };
}
