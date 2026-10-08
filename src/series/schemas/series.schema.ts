import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export const PENDING_VIDEO_STATUSES = [
  'awaiting_upload',
  'processing',
  'error',
] as const;
export type PendingVideoStatus = (typeof PENDING_VIDEO_STATUSES)[number];

export class Episode {
  @Prop({ required: true })
  episodeNumber!: number;

  @Prop({ required: true })
  seasonNumber!: number;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ trim: true })
  description?: string;

  // Optional since spec 0006: a pasted legacy link, kept until the episode
  // moves to Cloudflare Stream.
  @Prop({ type: String, default: null })
  videoUrl?: string | null;

  @Prop({ required: true })
  duration!: number;

  @Prop({ default: Date.now })
  releaseDate?: Date;

  @Prop({ default: 0 })
  views!: number;

  @Prop({ default: Date.now })
  createdAt?: Date;

  // Spec 0005. Mirrored in the inline episodes array below, which is the
  // definition Mongoose actually uses.
  @Prop({ type: String, default: null })
  thumbnail?: string | null;

  // Spec 0006: the Cloudflare video playing now, and the one being uploaded
  // or processed (first upload or a replacement).
  @Prop({ type: String, default: null })
  streamUid?: string | null;

  @Prop({ type: String, default: null })
  pendingStreamUid?: string | null;

  @Prop({ type: String, default: null })
  pendingStatus?: PendingVideoStatus | null;

  @Prop({ type: String, default: null })
  pendingError?: string | null;

  @Prop({ type: Date, default: null })
  pendingExpiresAt?: Date | null;

  @Prop({ type: Number, default: null })
  streamDuration?: number | null;
}

@Schema({ timestamps: true })
export class Series extends Document {
  @Prop({
    required: true,
    unique: true,
    trim: true,
  })
  title!: string;

  @Prop({ trim: true })
  description?: string;

  @Prop()
  coverImage?: string;

  @Prop()
  bannerImage?: string;

  @Prop({
    type: [{ type: Types.ObjectId, ref: 'Category' }],
    validate: {
      validator: (v: unknown[]) => Array.isArray(v) && v.length > 0,
      message: 'A series needs at least one category',
    },
  })
  categoryIds!: Types.ObjectId[];

  @Prop({
    type: [String],
    default: [],
  })
  languages!: string[];

  @Prop()
  country?: string;

  @Prop()
  releaseYear?: number;

  @Prop({ default: 0 })
  rating!: number;

  @Prop({ default: 0 })
  votes!: number;

  @Prop({
    type: [
      {
        episodeNumber: { type: Number, required: true },
        seasonNumber: { type: Number, required: true },
        title: { type: String, required: true },
        description: String,
        videoUrl: { type: String, default: null },
        duration: { type: Number, required: true },
        releaseDate: { type: Date, default: Date.now },
        views: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now },
        thumbnail: { type: String, default: null },
        streamUid: { type: String, default: null },
        pendingStreamUid: { type: String, default: null },
        pendingStatus: {
          type: String,
          enum: [...PENDING_VIDEO_STATUSES, null],
          default: null,
        },
        pendingError: { type: String, default: null },
        pendingExpiresAt: { type: Date, default: null },
        streamDuration: { type: Number, default: null },
      },
    ],
    default: [],
  })
  episodes!: Episode[];

  @Prop({ default: 0 })
  totalEpisodes!: number;

  // Spec 0008 AC-5: null until the series is announced to category fans,
  // set once when its first episode becomes playable. Series created before
  // that feature have no field at all, which means "already announced".
  @Prop({ type: Date, default: undefined })
  announcedAt?: Date | null;

  @Prop({
    type: String,
    enum: ['ongoing', 'completed'],
    default: 'ongoing',
  })
  status!: 'ongoing' | 'completed';

  @Prop({ type: Boolean, required: true, default: false })
  isPremium!: boolean;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  freeEpisodeCount!: number;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const SeriesSchema = SchemaFactory.createForClass(Series);

SeriesSchema.index({ title: 1 });
SeriesSchema.index({ categoryIds: 1 });
SeriesSchema.index({ rating: -1 });
SeriesSchema.index({ createdAt: -1 });
// Spec 0006: the webhook finds an episode from the Cloudflare uid alone.
SeriesSchema.index({ 'episodes.pendingStreamUid': 1 }, { sparse: true });
SeriesSchema.index({ 'episodes.streamUid': 1 }, { sparse: true });
