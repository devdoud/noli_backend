import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, SortOrder, isValidObjectId } from 'mongoose';
import { Category } from './schemas/category.schema';
import { Series } from '../series/schemas/series.schema';
import {
  CategorySeriesQueryDto,
  CreateCategoryDto,
  ReorderCategoriesDto,
  UpdateCategoryDto,
} from './dto/category.dto';
import { RESERVED_SLUGS, slugify } from './slugify';
import { MediaService } from '../media/media.service';
import {
  CATEGORY_POPULATE,
  PublicSeries,
  toPublicSeriesList,
} from '../series/content-access';

export const CATEGORY_IN_USE = 'CATEGORY_IN_USE';

const CATEGORY_ORDER = { displayOrder: 1, createdAt: 1, _id: 1 } as const;

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name) private readonly categoryModel: Model<Category>,
    @InjectModel(Series.name) private readonly seriesModel: Model<Series>,
    private readonly mediaService: MediaService,
  ) {}

  async listVisible(): Promise<Category[]> {
    return this.categoryModel
      .find({ isVisible: true })
      .sort(CATEGORY_ORDER)
      .lean()
      .exec();
  }

  async listAll(): Promise<Category[]> {
    return this.categoryModel.find().sort(CATEGORY_ORDER).lean().exec();
  }

  async findVisibleBySlug(slug: string): Promise<Category> {
    const category = await this.categoryModel
      .findOne({ slug, isVisible: true })
      .lean()
      .exec();
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    const nameKey = this.nameKeyOrThrow(dto.name);
    this.assertSlugAllowed(nameKey);

    if (await this.categoryModel.exists({ nameKey })) {
      throw new ConflictException('A category with this name already exists');
    }

    const last = await this.categoryModel
      .findOne()
      .sort({ displayOrder: -1 })
      .select('displayOrder')
      .lean()
      .exec();

    try {
      return await this.categoryModel.create({
        name: dto.name,
        nameKey,
        slug: nameKey,
        description: dto.description ?? null,
        imageUrl: dto.imageUrl ?? null,
        isVisible: dto.isVisible ?? true,
        displayOrder: last ? last.displayOrder + 1 : 0,
      });
    } catch (err) {
      throw this.mapDuplicateKey(err);
    }
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const fields = [
      'name',
      'description',
      'imageUrl',
      'isVisible',
      'slug',
    ] as const;
    if (fields.every((f) => dto[f] === undefined)) {
      throw new BadRequestException('Provide at least one field to update');
    }
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Category not found');
    }

    const set: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      set.name = dto.name;
      set.nameKey = this.nameKeyOrThrow(dto.name);
    }
    if (dto.description !== undefined) set.description = dto.description;
    if (dto.imageUrl !== undefined) set.imageUrl = dto.imageUrl;
    if (dto.isVisible !== undefined) set.isVisible = dto.isVisible;
    if (dto.slug !== undefined) {
      this.assertSlugAllowed(dto.slug);
      set.slug = dto.slug;
    }

    // A pasted imageUrl (spec 0005 AC-9) reads the old value from the same
    // atomic write, then deletes the uploaded file it replaced.
    const pastesImage = dto.imageUrl !== undefined;

    let category: Category | null;
    try {
      category = await this.categoryModel.findByIdAndUpdate(
        id,
        { $set: set },
        { new: !pastesImage, runValidators: true },
      );
    } catch (err) {
      throw this.mapDuplicateKey(err);
    }
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    if (!pastesImage) {
      return category;
    }

    const oldUrl = category.imageUrl;
    if (oldUrl && oldUrl !== dto.imageUrl) {
      await this.mediaService.destroyIfOwned(oldUrl, 'categoryImage', {
        categoryId: String(id),
      });
    }
    return this.findByIdOrThrow(id);
  }

  // PUT /categories/:id/image (spec 0005 AC-3).
  async setImage(
    id: string,
    file: Express.Multer.File | undefined,
  ): Promise<Category> {
    const current = await this.findByIdOrThrow(id);
    return this.mediaService.replaceImage({
      file,
      slot: 'categoryImage',
      owner: { categoryId: String(id) },
      currentUrl: current.imageUrl ?? null,
      save: (oldUrl, newUrl) =>
        this.categoryModel
          .findOneAndUpdate(
            { _id: id, imageUrl: oldUrl },
            { $set: { imageUrl: newUrl } },
            { new: true },
          )
          .exec(),
      exists: async () => Boolean(await this.categoryModel.exists({ _id: id })),
      notFoundMessage: 'Category not found',
    });
  }

  // DELETE /categories/:id/image (spec 0005 AC-7).
  async removeImage(id: string): Promise<Category> {
    const current = await this.findByIdOrThrow(id);
    return this.mediaService.removeImage({
      slot: 'categoryImage',
      owner: { categoryId: String(id) },
      current,
      currentUrl: current.imageUrl ?? null,
      save: (oldUrl) =>
        this.categoryModel
          .findOneAndUpdate(
            { _id: id, imageUrl: oldUrl },
            { $set: { imageUrl: null } },
            { new: true },
          )
          .exec(),
      exists: async () => Boolean(await this.categoryModel.exists({ _id: id })),
      notFoundMessage: 'Category not found',
    });
  }

  private async findByIdOrThrow(id: string): Promise<Category> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Category not found');
    }
    const category = await this.categoryModel.findById(id).exec();
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  // No transactions here (the database may not be a replica set): "nothing
  // changes" is guaranteed for validation failures, which are all checked
  // before the single bulkWrite.
  async reorder(dto: ReorderCategoriesDto): Promise<Category[]> {
    const existing = await this.categoryModel
      .find({}, { _id: 1 })
      .lean()
      .exec();
    const existingIds = new Set(existing.map((c) => String(c._id)));
    const complete =
      dto.ids.length === existingIds.size &&
      dto.ids.every((id) => existingIds.has(id));
    if (!complete) {
      throw new BadRequestException(
        'ids must list every category exactly once (hidden ones included)',
      );
    }

    if (dto.ids.length > 0) {
      await this.categoryModel.bulkWrite(
        dto.ids.map((id, index) => ({
          updateOne: {
            filter: { _id: id },
            update: { $set: { displayOrder: index } },
          },
        })),
      );
    }
    return this.listAll();
  }

  async remove(id: string): Promise<void> {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Category not found');
    }
    if (!(await this.categoryModel.exists({ _id: id }))) {
      throw new NotFoundException('Category not found');
    }

    const seriesCount = await this.seriesModel.countDocuments({
      categoryIds: id,
    });
    if (seriesCount > 0) {
      throw new ConflictException({
        statusCode: 409,
        code: CATEGORY_IN_USE,
        message: 'Move or edit the series in this category before deleting it',
        seriesCount,
      });
    }

    await this.categoryModel.deleteOne({ _id: id });
    // Best effort (spec 0005 AC-8); a category in use never gets here.
    await this.mediaService.destroyByPrefix(
      this.mediaService.categoryFolder(String(id)),
    );
  }

  async getSeriesInCategory(
    slug: string,
    query: CategorySeriesQueryDto,
  ): Promise<{
    total: number;
    page: number;
    limit: number;
    series: PublicSeries[];
  }> {
    const category = await this.findVisibleBySlug(slug);
    const filter = { categoryIds: category._id };
    // Final _id tiebreak so pagination never skips or repeats a series.
    const sort: Record<string, SortOrder> =
      query.sort === 'rating'
        ? { rating: -1, votes: -1, _id: -1 }
        : { createdAt: -1, _id: -1 };

    const total = await this.seriesModel.countDocuments(filter);
    const series = await this.seriesModel
      .find(filter)
      .select('-episodes')
      .populate(CATEGORY_POPULATE)
      .sort(sort)
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean()
      .exec();

    return {
      total,
      page: query.page,
      limit: query.limit,
      series: toPublicSeriesList(series),
    };
  }

  private nameKeyOrThrow(name: string): string {
    const key = slugify(name);
    if (!key) {
      throw new BadRequestException(
        'The name must contain at least one letter or digit (a-z, 0-9)',
      );
    }
    return key;
  }

  private assertSlugAllowed(slug: string): void {
    if (RESERVED_SLUGS.includes(slug)) {
      throw new BadRequestException(
        `"${slug}" is reserved, pick another name or slug`,
      );
    }
  }

  // Two identical requests can both pass the exists() check; the unique index
  // then rejects one with E11000, which must be a 409, not a 500.
  private mapDuplicateKey(err: unknown): unknown {
    const e = err as { code?: number; keyPattern?: Record<string, unknown> };
    if (e?.code === 11000) {
      const field =
        Object.keys(e.keyPattern ?? {})[0] === 'slug' ? 'slug' : 'name';
      return new ConflictException(
        `A category with this ${field} already exists`,
      );
    }
    return err;
  }
}
