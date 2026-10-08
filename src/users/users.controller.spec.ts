import { Test } from '@nestjs/testing';
import { UploadThrottlerGuard } from '../media/upload-throttler.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController avatar routes (spec 0005 AC-4)', () => {
  let controller: UsersController;
  const service = {
    setAvatar: jest.fn(),
    removeAvatar: jest.fn(),
    findById: jest.fn(),
  };
  const profile = {
    _id: 'me',
    email: 'me@example.com',
    username: 'me',
    role: 'user',
    avatar: 'https://new',
    password: 'never returned',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    })
      .overrideGuard(UploadThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(UsersController);
  });

  it('uploads for the token owner only and returns the shared profile shape', async () => {
    service.setAvatar.mockResolvedValue(profile);
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;

    const result = await controller.uploadAvatar(file, {
      user: { _id: { toString: () => 'me' } },
    });

    expect(service.setAvatar).toHaveBeenCalledWith('me', file);
    expect(result).toEqual({
      message: 'Avatar updated',
      user: {
        id: 'me',
        email: 'me@example.com',
        username: 'me',
        firstName: undefined,
        lastName: undefined,
        avatar: 'https://new',
        role: 'user',
        subscription: undefined,
        createdAt: undefined,
      },
    });
  });

  it('removes for the token owner and returns avatar null', async () => {
    service.removeAvatar.mockResolvedValue({ ...profile, avatar: null });

    const result = await controller.removeAvatar({ user: { _id: 'me' } });

    expect(service.removeAvatar).toHaveBeenCalledWith('me');
    expect(result.message).toBe('Avatar removed');
    expect(result.user.avatar).toBeNull();
  });

  it('GET /users/:id uses the same profile shape', async () => {
    service.findById.mockResolvedValue({ ...profile, avatar: undefined });
    const result = await controller.findById('me');
    expect(result.avatar).toBeNull();
    expect(result).not.toHaveProperty('password');
  });
});
