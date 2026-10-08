import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WatchHistory } from './schemas/watch-history.schema';
import { AddToWatchHistoryDto } from './dto/add-to-watch-history.dto';

@Injectable()
export class WatchHistoryService {
  constructor(
    @InjectModel(WatchHistory.name)
    private watchHistoryModel: Model<WatchHistory>,
  ) {}

  // Ajouter un épisode à l'historique
  async addToWatchHistory(
    userId: string,
    addToWatchHistoryDto: AddToWatchHistoryDto,
  ): Promise<WatchHistory> {
    // Vérifier si l'utilisateur a déjà un historique
    let watchHistory = await this.watchHistoryModel.findOne({ userId });

    if (!watchHistory) {
      // Créer un nouvel historique
      watchHistory = await this.watchHistoryModel.create({
        userId,
        episodes: [
          {
            ...addToWatchHistoryDto,
            watchedAt: new Date(),
            lastWatchedAt: new Date(),
            progressPercentage: addToWatchHistoryDto.progressPercentage || 0,
            isCompleted:
              addToWatchHistoryDto.progressPercentage === 100 || false,
          },
        ],
      });

      return watchHistory;
    }

    // Chercher si l'épisode existe déjà
    const existingEpisodeIndex = watchHistory.episodes.findIndex(
      (ep) =>
        ep.seriesId === addToWatchHistoryDto.seriesId &&
        ep.episodeNumber === addToWatchHistoryDto.episodeNumber &&
        ep.seasonNumber === addToWatchHistoryDto.seasonNumber,
    );

    if (existingEpisodeIndex !== -1) {
      // Mettre à jour l'épisode existant
      watchHistory.episodes[existingEpisodeIndex] = {
        ...watchHistory.episodes[existingEpisodeIndex],
        ...addToWatchHistoryDto,
        lastWatchedAt: new Date(),
        isCompleted: addToWatchHistoryDto.progressPercentage === 100 || false,
      };
    } else {
      // Ajouter le nouvel épisode
      watchHistory.episodes.push({
        ...addToWatchHistoryDto,
        watchedAt: new Date(),
        lastWatchedAt: new Date(),
        progressPercentage: addToWatchHistoryDto.progressPercentage || 0,
        isCompleted: addToWatchHistoryDto.progressPercentage === 100 || false,
      } as any);
    }

    await watchHistory.save();
    return watchHistory;
  }

  // Récupérer l'historique paginé
  async getWatchHistory(
    userId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    total: number;
    page: number;
    limit: number;
    history: WatchHistory;
  }> {
    const watchHistory = await this.watchHistoryModel.findOne({ userId });

    if (!watchHistory) {
      throw new NotFoundException('Watch history not found');
    }

    // Trier par lastWatchedAt (plus récent d'abord)
    const sortedEpisodes = watchHistory.episodes
      .sort(
        (a, b) =>
          new Date(b.lastWatchedAt).getTime() -
          new Date(a.lastWatchedAt).getTime(),
      )
      .slice((page - 1) * limit, page * limit);

    return {
      total: watchHistory.episodes.length,
      page,
      limit,
      history: {
        ...watchHistory.toObject(),
        episodes: sortedEpisodes,
      } as any,
    };
  }

  // Récupérer "Continuer à regarder" (non complétés)
  async getContinueWatching(
    userId: string,
    limit: number = 5,
  ): Promise<WatchHistory> {
    const watchHistory = await this.watchHistoryModel.findOne({ userId });

    if (!watchHistory) {
      throw new NotFoundException('Watch history not found');
    }

    // Filtrer les épisodes non complétés et les trier par lastWatchedAt
    const continueWatching = watchHistory.episodes
      .filter((ep) => !ep.isCompleted)
      .sort(
        (a, b) =>
          new Date(b.lastWatchedAt).getTime() -
          new Date(a.lastWatchedAt).getTime(),
      )
      .slice(0, limit);

    return {
      ...watchHistory.toObject(),
      episodes: continueWatching,
    } as any;
  }

  // Every series the user ever watched, finished or not (spec 0003: the
  // tastes behind personalized recommendations). No history → empty list.
  async getWatchedSeriesIds(userId: string): Promise<string[]> {
    const watchHistory = await this.watchHistoryModel.findOne({ userId });
    return [...new Set((watchHistory?.episodes ?? []).map((ep) => ep.seriesId))];
  }

  // Supprimer un épisode de l'historique
  async removeFromHistory(
    userId: string,
    seriesId: string,
    episodeNumber: number,
    seasonNumber: number,
  ): Promise<WatchHistory> {
    const watchHistory = await this.watchHistoryModel.findOne({ userId });

    if (!watchHistory) {
      throw new NotFoundException('Watch history not found');
    }

    // Supprimer l'épisode
    watchHistory.episodes = watchHistory.episodes.filter(
      (ep) =>
        !(
          ep.seriesId === seriesId &&
          ep.episodeNumber === episodeNumber &&
          ep.seasonNumber === seasonNumber
        ),
    );

    await watchHistory.save();
    return watchHistory;
  }

  // Mettre à jour la progression d'un épisode
  async updateProgress(
    userId: string,
    seriesId: string,
    episodeNumber: number,
    seasonNumber: number,
    progressPercentage: number,
  ): Promise<WatchHistory> {
    if (progressPercentage < 0 || progressPercentage > 100) {
      throw new BadRequestException('Progress must be between 0 and 100');
    }

    const watchHistory = await this.watchHistoryModel.findOne({ userId });

    if (!watchHistory) {
      throw new NotFoundException('Watch history not found');
    }

    const episode = watchHistory.episodes.find(
      (ep) =>
        ep.seriesId === seriesId &&
        ep.episodeNumber === episodeNumber &&
        ep.seasonNumber === seasonNumber,
    );

    if (!episode) {
      throw new NotFoundException('Episode not found in watch history');
    }

    episode.progressPercentage = progressPercentage;
    episode.isCompleted = progressPercentage === 100;
    episode.lastWatchedAt = new Date();

    await watchHistory.save();
    return watchHistory;
  }

  // Supprimer toute l'historique (optionnel)
  async clearWatchHistory(userId: string): Promise<void> {
    await this.watchHistoryModel.deleteOne({ userId });
  }

  // Catalog cascades (spec 0004). seriesId is stored as a string in history,
  // so callers pass String(id). All three filter on the episodes.seriesId
  // index, and skip timestamps so a catalog change doesn't bump every
  // affected user's updatedAt.
  async removeEpisodeEverywhere(
    seriesId: string,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<void> {
    await this.watchHistoryModel.updateMany(
      { 'episodes.seriesId': seriesId },
      { $pull: { episodes: { seriesId, seasonNumber, episodeNumber } } },
      { timestamps: false },
    );
  }

  async removeSeriesEverywhere(seriesId: string): Promise<void> {
    await this.watchHistoryModel.updateMany(
      { 'episodes.seriesId': seriesId },
      { $pull: { episodes: { seriesId } } },
      { timestamps: false },
    );
  }

  async renameEpisodeEverywhere(
    seriesId: string,
    seasonNumber: number,
    episodeNumber: number,
    title: string,
  ): Promise<void> {
    await this.watchHistoryModel.updateMany(
      { 'episodes.seriesId': seriesId },
      { $set: { 'episodes.$[e].title': title } },
      {
        arrayFilters: [
          {
            'e.seriesId': seriesId,
            'e.seasonNumber': seasonNumber,
            'e.episodeNumber': episodeNumber,
          },
        ],
        timestamps: false,
      },
    );
  }
}
