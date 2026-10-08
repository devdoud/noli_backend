import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotificationJob } from './schemas/notification-job.schema';

// The one call content hooks make (spec 0008 AC-18): a small insert in the
// same request. It never throws; a failure is logged and the admin action
// goes on.
@Injectable()
export class NotificationQueue {
  private readonly logger = new Logger(NotificationQueue.name);

  constructor(
    @InjectModel(NotificationJob.name)
    private readonly jobModel: Model<NotificationJob>,
  ) {}

  async episodePlayable(
    seriesId: Types.ObjectId | string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<void> {
    try {
      await this.jobModel.create({
        kind: 'episode_playable',
        payload: {
          seriesId: seriesId.toString(),
          seasonNumber,
          episodeNumber,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not queue episode_playable for series ${seriesId.toString()} S${seasonNumber}E${episodeNumber}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
