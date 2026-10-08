import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface EpisodePlayablePayload {
  seriesId: string;
  seasonNumber: number;
  episodeNumber: number;
  // Set once this job has claimed the series announcement (AC-5), so a retry
  // finishes the new series fan out instead of switching to new episodes.
  announcing?: boolean;
}

// The queue for content events (spec 0008). finishedAt drives the 7 day
// cleanup of done and failed jobs; pending ones have none and never expire.
@Schema({ collection: 'notification_jobs', timestamps: true })
export class NotificationJob {
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['episode_playable'] })
  kind!: 'episode_playable';

  @Prop({ type: Object, required: true })
  payload!: EpisodePlayablePayload;

  @Prop({ type: String, required: true, default: 'pending' })
  status!: JobStatus;

  @Prop({ default: 0 })
  attempts!: number;

  @Prop({ type: Date, default: () => new Date() })
  runAfter!: Date;

  @Prop({ type: Date, default: null })
  lockedAt!: Date | null;

  @Prop({ type: String, default: null })
  error!: string | null;

  @Prop({ type: Date, default: undefined })
  finishedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const NotificationJobSchema =
  SchemaFactory.createForClass(NotificationJob);
NotificationJobSchema.index({ status: 1, runAfter: 1 });
NotificationJobSchema.index(
  { finishedAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 },
);
