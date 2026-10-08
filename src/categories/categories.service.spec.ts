import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CategoriesService } from './categories.service';
import { Category } from './schemas/category.schema';
import { Series } from '../series/schemas/series.schema';
import { MediaService } from '../media/media.service';
import { CATEGORY_POPULATE } from '../series/content-access';

describe('CategoriesService', () => {
  let service: CategoriesService;
  let categoryModel: any;
  let seriesModel: any;

  // The MediaService mock the service was built with.
  const media = () => (service as any).mediaService;
  const idA = new Types.ObjectId().toString();
  const idB = new Types.ObjectId().toString();

  function chain(result: any) {
    return {
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(result),
    };
  }

  beforeEach(async () => {
    categoryModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      exists: jest.fn(),
      create: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      bulkWrite: jest.fn(),
      deleteOne: jest.fn(),
    };
    seriesModel = { countDocuments: jest.fn(), find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: getModelToken(Category.name), useValue: categoryModel },
        { provide: getModelToken(Series.name), useValue: seriesModel },
        {
          provide: MediaService,
          useValue: {
            destroyByPrefix: jest.fn(),
            destroyIfOwned: jest.fn(),
            replaceImage: jest.fn(),
            removeImage: jest.fn(),
            seriesFolder: jest.fn((id: string) => `noli/test/series/${id}/`),
            categoryFolder: jest.fn((id: string) => `noli/test/categories/${id}/`),
            episodeThumbnailPrefix: jest.fn(
              (id: string, s: number, e: number) => `noli/test/series/${id}/episodes/s${s}e${e}-`,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  describe('create (AC-1)', () => {
    it('derives slug and nameKey from the name and places it last', async () => {
      categoryModel.exists.mockResolvedValue(null);
      categoryModel.findOne.mockReturnValue(chain({ displayOrder: 4 }));
      categoryModel.create.mockImplementation(async (doc: any) => doc);

      const result: any = await service.create({ name: 'Comédie romantique' });

      expect(result).toMatchObject({
        name: 'Comédie romantique',
        nameKey: 'comedie-romantique',
        slug: 'comedie-romantique',
        displayOrder: 5,
        isVisible: true,
        description: null,
        imageUrl: null,
      });
    });

    it('starts the order at 0 when there are no categories', async () => {
      categoryModel.exists.mockResolvedValue(null);
      categoryModel.findOne.mockReturnValue(chain(null));
      categoryModel.create.mockImplementation(async (doc: any) => doc);

      const result: any = await service.create({ name: 'Drame' });

      expect(result.displayOrder).toBe(0);
    });

    it('rejects a near duplicate name with 409', async () => {
      categoryModel.exists.mockResolvedValue({ _id: idA });

      await expect(
        service.create({ name: 'comedie ROMANTIQUE' }),
      ).rejects.toThrow(ConflictException);
      expect(categoryModel.exists).toHaveBeenCalledWith({
        nameKey: 'comedie-romantique',
      });
    });

    it('maps a racing duplicate key error to 409, not 500', async () => {
      categoryModel.exists.mockResolvedValue(null);
      categoryModel.findOne.mockReturnValue(chain(null));
      categoryModel.create.mockRejectedValue({
        code: 11000,
        keyPattern: { nameKey: 1 },
      });

      await expect(service.create({ name: 'Drame' })).rejects.toThrow(
        ConflictException,
      );
    });

    it.each(['!!!', 'All', 'ORDER'])(
      'rejects %s with 400 (empty or reserved slug)',
      async (name) => {
        await expect(service.create({ name })).rejects.toThrow(
          BadRequestException,
        );
        expect(categoryModel.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('update (AC-2)', () => {
    it('recomputes nameKey on rename but keeps the slug', async () => {
      categoryModel.findByIdAndUpdate.mockResolvedValue({ _id: idA });

      await service.update(idA, { name: 'Comédies' });

      const [, update, options] = categoryModel.findByIdAndUpdate.mock.calls[0];
      expect(update.$set).toEqual({ name: 'Comédies', nameKey: 'comedies' });
      expect(update.$set).not.toHaveProperty('slug');
      expect(options).toEqual({ new: true, runValidators: true });
    });

    it('clears description and imageUrl with null', async () => {
      categoryModel.findByIdAndUpdate.mockResolvedValue({ _id: idA });
      categoryModel.findById = jest.fn(() => ({
        exec: jest.fn().mockResolvedValue({ _id: idA, imageUrl: null }),
      }));

      await service.update(idA, { description: null, imageUrl: null });

      expect(categoryModel.findByIdAndUpdate.mock.calls[0][1].$set).toEqual({
        description: null,
        imageUrl: null,
      });
    });

    it('rejects a body with no known field', async () => {
      await expect(service.update(idA, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a reserved slug', async () => {
      await expect(service.update(idA, { slug: 'all' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('reports which field collided on a duplicate key', async () => {
      categoryModel.findByIdAndUpdate.mockRejectedValue({
        code: 11000,
        keyPattern: { slug: 1 },
      });

      const error = await service
        .update(idA, { slug: 'drame' })
        .catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toContain('slug');
    });

    it('returns 404 for a malformed or unknown id', async () => {
      await expect(
        service.update('nope', { isVisible: false }),
      ).rejects.toThrow(NotFoundException);

      categoryModel.findByIdAndUpdate.mockResolvedValue(null);
      await expect(service.update(idA, { isVisible: false })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reorder (AC-3)', () => {
    beforeEach(() => {
      categoryModel.find.mockImplementation((filter: any, projection: any) =>
        projection ? chain([{ _id: idA }, { _id: idB }]) : chain([]),
      );
    });

    it('writes every position in one bulkWrite', async () => {
      await service.reorder({ ids: [idB, idA] });

      expect(categoryModel.bulkWrite).toHaveBeenCalledWith([
        {
          updateOne: {
            filter: { _id: idB },
            update: { $set: { displayOrder: 0 } },
          },
        },
        {
          updateOne: {
            filter: { _id: idA },
            update: { $set: { displayOrder: 1 } },
          },
        },
      ]);
    });

    it.each([
      ['missing one', () => [idA]],
      ['unknown id', () => [idA, new Types.ObjectId().toString()]],
    ])('rejects a list with %s and changes nothing', async (_label, ids) => {
      await expect(service.reorder({ ids: ids() })).rejects.toThrow(
        BadRequestException,
      );
      expect(categoryModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('accepts an empty list when there are no categories', async () => {
      categoryModel.find.mockImplementation(() => chain([]));

      await expect(service.reorder({ ids: [] })).resolves.toEqual([]);
      expect(categoryModel.bulkWrite).not.toHaveBeenCalled();
    });
  });

  describe('remove (AC-4)', () => {
    it('refuses while series use the category, with the count', async () => {
      categoryModel.exists.mockResolvedValue({ _id: idA });
      seriesModel.countDocuments.mockResolvedValue(3);

      const error = await service.remove(idA).catch((e) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        code: 'CATEGORY_IN_USE',
        message: expect.any(String),
        seriesCount: 3,
      });
      expect(categoryModel.deleteOne).not.toHaveBeenCalled();
    });

    it('deletes an unused category, then cleans its image folder (spec 0005 AC-8)', async () => {
      categoryModel.exists.mockResolvedValue({ _id: idA });
      seriesModel.countDocuments.mockResolvedValue(0);

      await service.remove(idA);

      expect(categoryModel.deleteOne).toHaveBeenCalledWith({ _id: idA });
      expect(media().destroyByPrefix).toHaveBeenCalledWith(
        `noli/test/categories/${idA}/`,
      );
    });

    it('returns 404 for an unknown category', async () => {
      categoryModel.exists.mockResolvedValue(null);

      await expect(service.remove(idA)).rejects.toThrow(NotFoundException);
      expect(media().destroyByPrefix).not.toHaveBeenCalled();
    });

    it('never cleans the folder of a category still in use', async () => {
      categoryModel.exists.mockResolvedValue({ _id: idA });
      seriesModel.countDocuments.mockResolvedValue(2);

      await expect(service.remove(idA)).rejects.toThrow(ConflictException);
      expect(media().destroyByPrefix).not.toHaveBeenCalled();
    });
  });

  describe('image (spec 0005)', () => {
    const pasted = 'https://example.com/old.jpg';
    const findByIdResolving = (doc: any) =>
      jest.fn(() => ({ exec: jest.fn().mockResolvedValue(doc) }));

    it('setImage passes the current URL and saves with a compare and set filter (AC-3, AC-13)', async () => {
      categoryModel.findById = findByIdResolving({ _id: idA, imageUrl: pasted });
      categoryModel.findOneAndUpdate = jest.fn(() => ({
        exec: jest.fn().mockResolvedValue('doc'),
      }));
      media().replaceImage.mockResolvedValue('saved');
      const file = { buffer: Buffer.from('x') } as Express.Multer.File;

      await expect(service.setImage(idA, file)).resolves.toBe('saved');

      const opts = media().replaceImage.mock.calls[0][0];
      expect(opts).toMatchObject({
        file,
        slot: 'categoryImage',
        owner: { categoryId: idA },
        currentUrl: pasted,
      });
      await expect(opts.save(pasted, 'https://new')).resolves.toBe('doc');
      expect(categoryModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: idA, imageUrl: pasted },
        { $set: { imageUrl: 'https://new' } },
        { new: true },
      );
    });

    it('removeImage clears to null, and 404s on an unknown or malformed id (AC-7, AC-10)', async () => {
      categoryModel.findById = findByIdResolving({ _id: idA, imageUrl: pasted });
      categoryModel.findOneAndUpdate = jest.fn(() => ({
        exec: jest.fn().mockResolvedValue('doc'),
      }));
      await service.removeImage(idA);
      await media().removeImage.mock.calls[0][0].save(pasted);
      expect(categoryModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: idA, imageUrl: pasted },
        { $set: { imageUrl: null } },
        { new: true },
      );

      await expect(service.removeImage('bad')).rejects.toThrow(NotFoundException);
      categoryModel.findById = findByIdResolving(null);
      await expect(service.removeImage(idA)).rejects.toThrow(NotFoundException);
    });

    it('a pasted imageUrl deletes the owned file it replaced, read from the same write (AC-9)', async () => {
      categoryModel.findByIdAndUpdate.mockResolvedValue({ _id: idA, imageUrl: 'https://old' });
      categoryModel.findById = findByIdResolving({ _id: idA, imageUrl: 'https://new' });

      const result = await service.update(idA, { imageUrl: 'https://new' });

      expect(categoryModel.findByIdAndUpdate.mock.calls[0][2]).toEqual({
        new: false,
        runValidators: true,
      });
      expect(media().destroyIfOwned).toHaveBeenCalledWith('https://old', 'categoryImage', {
        categoryId: idA,
      });
      expect(result).toEqual({ _id: idA, imageUrl: 'https://new' });
    });

    it('sending the same URL again deletes nothing', async () => {
      categoryModel.findByIdAndUpdate.mockResolvedValue({ _id: idA, imageUrl: pasted });
      categoryModel.findById = findByIdResolving({ _id: idA, imageUrl: pasted });

      await service.update(idA, { imageUrl: pasted });

      expect(media().destroyIfOwned).not.toHaveBeenCalled();
    });
  });

  describe('lists and browsing (AC-5, AC-6)', () => {
    it('lists visible categories in display order', async () => {
      const c = chain([]);
      categoryModel.find.mockReturnValue(c);

      await service.listVisible();

      expect(categoryModel.find).toHaveBeenCalledWith({ isVisible: true });
      expect(c.sort).toHaveBeenCalledWith({
        displayOrder: 1,
        createdAt: 1,
        _id: 1,
      });
    });

    it('returns 404 for an unknown or hidden slug', async () => {
      categoryModel.findOne.mockReturnValue(chain(null));

      await expect(service.findVisibleBySlug('secret')).rejects.toThrow(
        NotFoundException,
      );
      expect(categoryModel.findOne).toHaveBeenCalledWith({
        slug: 'secret',
        isVisible: true,
      });
    });

    it('paginates series in a category, best rated with an _id tiebreak, mapped with categories', async () => {
      categoryModel.findOne.mockReturnValue(chain({ _id: idA }));
      seriesModel.countDocuments.mockResolvedValue(12);
      const s = chain([
        {
          _id: 's1',
          categoryIds: [{ _id: idA, name: 'Drame', slug: 'drame' }],
        },
      ]);
      seriesModel.find.mockReturnValue(s);

      const result = await service.getSeriesInCategory('drame', {
        page: 2,
        limit: 5,
        sort: 'rating',
      });

      expect(seriesModel.find).toHaveBeenCalledWith({ categoryIds: idA });
      expect(s.select).toHaveBeenCalledWith('-episodes');
      expect(s.populate).toHaveBeenCalledWith(CATEGORY_POPULATE);
      expect(s.sort).toHaveBeenCalledWith({ rating: -1, votes: -1, _id: -1 });
      expect(s.skip).toHaveBeenCalledWith(5);
      expect(s.limit).toHaveBeenCalledWith(5);
      expect(result).toEqual({
        total: 12,
        page: 2,
        limit: 5,
        series: [
          {
            _id: 's1',
            categories: [{ _id: idA, name: 'Drame', slug: 'drame' }],
          },
        ],
      });
    });
  });
});
