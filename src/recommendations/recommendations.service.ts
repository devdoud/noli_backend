import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import { Series } from '../series/schemas/series.schema';
import { Category } from '../categories/schemas/category.schema';
import { WatchHistoryService } from '../watch-history/watch-history.service';
import { CATEGORY_POPULATE } from '../series/content-access';

@Injectable()
export class RecommendationsService {
  constructor(
    @InjectModel(Series.name) private seriesModel: Model<Series>,
    @InjectModel(Category.name) private categoryModel: Model<Category>,
    private watchHistoryService: WatchHistoryService,
  ) {}

  // Personalized picks: series sharing a category with what the user watched,
  // finished episodes included. Matching reads the raw categoryIds (hidden
  // categories included); only the returned series are populated, and only
  // with visible category names. Nothing to match → popular series. Errors
  // are not swallowed: a failing database must not look like a fallback.
  async getRecommendations(
    userId: string,
    limit: number = 10,
  ): Promise<Series[]> {
    // WatchHistory.seriesId is a plain string: drop anything that isn't a
    // valid id before it reaches a query.
    const watchedIds = (
      await this.watchHistoryService.getWatchedSeriesIds(userId)
    ).filter((id) => isValidObjectId(id));
    if (watchedIds.length === 0) {
      return this.getPopularSeries(limit);
    }

    const watchedSeries = await this.seriesModel
      .find({ _id: { $in: watchedIds } }, { categoryIds: 1 })
      .lean()
      .exec();

    const categoryIds = [
      ...new Set(
        watchedSeries.flatMap((s) => (s.categoryIds ?? []).map(String)),
      ),
    ].map((id) => new Types.ObjectId(id));
    if (categoryIds.length === 0) {
      // Watched series deleted, or with no category: nothing to match on.
      return this.getPopularSeries(limit);
    }

    return this.seriesModel
      .find({
        _id: { $nin: watchedIds },
        categoryIds: { $in: categoryIds },
      })
      .select('-episodes')
      .populate(CATEGORY_POPULATE)
      .sort({ rating: -1, votes: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async getPopularSeries(limit: number = 10): Promise<Series[]> {
    return this.seriesModel
      .find()
      .select('-episodes')
      .populate(CATEGORY_POPULATE)
      .sort({ rating: -1, votes: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async getSimilarSeries(
    seriesId: string,
    limit: number = 5,
  ): Promise<Series[]> {
    const series = await this.seriesModel
      .findById(seriesId, { categoryIds: 1 })
      .lean()
      .exec();

    if (!series) {
      throw new NotFoundException('Series not found');
    }

    return this.seriesModel
      .find({
        _id: { $ne: seriesId },
        categoryIds: { $in: series.categoryIds ?? [] },
      })
      .select('-episodes')
      .populate(CATEGORY_POPULATE)
      .sort({ rating: -1, votes: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async getCategoryRecommendations(
    slug: string,
    limit: number = 10,
  ): Promise<Series[]> {
    const category = await this.categoryModel
      .findOne({ slug, isVisible: true }, { _id: 1 })
      .lean()
      .exec();

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return this.seriesModel
      .find({ categoryIds: category._id })
      .select('-episodes')
      .populate(CATEGORY_POPULATE)
      .sort({ rating: -1, votes: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async getNewSeries(limit: number = 10): Promise<Series[]> {
    return this.seriesModel
      .find()
      .select('-episodes')
      .populate(CATEGORY_POPULATE)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async getTopRatedSeries(limit: number = 10): Promise<Series[]> {
    return this.seriesModel
      .find()
      .select('-episodes')
      .populate(CATEGORY_POPULATE)
      .sort({ rating: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  async getTrendingNow(limit: number = 10): Promise<Series[]> {
    return this.seriesModel
      .find()
      .select('-episodes')
      .populate(CATEGORY_POPULATE)
      .sort({ votes: -1, rating: -1 })
      .limit(limit)
      .lean()
      .exec();
  }
}
