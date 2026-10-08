import { Test, TestingModule } from '@nestjs/testing';
import { UploadThrottlerGuard } from '../media/upload-throttler.guard';
import { ForbiddenException } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

describe('CategoriesController (admin checks)', () => {
  let controller: CategoriesController;
  const service = {
    listVisible: jest.fn().mockResolvedValue([]),
    listAll: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    reorder: jest.fn(),
    remove: jest.fn(),
    setImage: jest.fn(),
    removeImage: jest.fn(),
  };
  const user = { user: { role: 'user' } };
  const admin = { user: { role: 'admin' } };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [{ provide: CategoriesService, useValue: service }],
    })
      .overrideGuard(UploadThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(CategoriesController);
  });

  it.each([
    ['listAll', (c: CategoriesController, r: any) => c.listAll(r), 'listAll'],
    [
      'create',
      (c: CategoriesController, r: any) => c.create({ name: 'X' }, r),
      'create',
    ],
    [
      'reorder',
      (c: CategoriesController, r: any) => c.reorder({ ids: [] }, r),
      'reorder',
    ],
    [
      'update',
      (c: CategoriesController, r: any) =>
        c.update('id', { isVisible: false }, r),
      'update',
    ],
    [
      'remove',
      (c: CategoriesController, r: any) => c.remove('id', r),
      'remove',
    ],
    [
      'uploadImage',
      (c: CategoriesController, r: any) =>
        c.uploadImage('id', { buffer: Buffer.from('x') } as any, r),
      'setImage',
    ],
    [
      'removeImage',
      (c: CategoriesController, r: any) => c.removeImage('id', r),
      'removeImage',
    ],
  ] as const)('%s is admin only (AC-5)', async (_name, call, method) => {
    await expect(call(controller, user)).rejects.toThrow(ForbiddenException);
    expect(service[method]).not.toHaveBeenCalled();

    await call(controller, admin);
    expect(service[method]).toHaveBeenCalled();
  });

  it('lists visible categories publicly', async () => {
    const result = await controller.listVisible();
    expect(result.categories).toEqual([]);
  });
});
