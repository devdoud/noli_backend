import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Classe pour les détails d'un épisode regardé
export class EpisodeWatch {
  @Prop({ required: true })
  seriesId!: string; // ← Ajoute !

  @Prop({ required: true })
  episodeNumber!: number; // ← Ajoute !

  @Prop({ required: true })
  seasonNumber!: number; // ← Ajoute !

  @Prop({ required: true })
  title!: string; // ← Ajoute !

  @Prop({ default: 0 })
  watchedDuration!: number; // ← Pas besoin, a default

  @Prop({ default: 0 })
  totalDuration!: number; // ← Pas besoin, a default

  @Prop({ default: Date.now })
  watchedAt!: Date; // ← Pas besoin, a default

  @Prop({ default: Date.now })
  lastWatchedAt!: Date; // ← Pas besoin, a default

  @Prop({ default: false })
  isCompleted!: boolean; // ← Pas besoin, a default

  @Prop({ default: 0 })
  progressPercentage!: number; // ← Pas besoin, a default
}

// Le document principal WatchHistory
@Schema({ timestamps: true })
export class WatchHistory extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: string; // ← L'utilisateur

  @Prop({ type: [EpisodeWatch], default: [] })
  episodes!: EpisodeWatch[]; // ← Liste des épisodes regardés

  @Prop({ default: 0 })
  totalTimeSpent!: number; // ← Temps total passé (secondes)

  @Prop({ default: Date.now })
  createdAt!: Date;

  @Prop({ default: Date.now })
  updatedAt!: Date;
}

export const WatchHistorySchema = SchemaFactory.createForClass(WatchHistory);

// Ajouter des index pour les recherches rapides
WatchHistorySchema.index({ userId: 1 });
WatchHistorySchema.index({ 'episodes.seriesId': 1 });
WatchHistorySchema.index({ updatedAt: -1 });
