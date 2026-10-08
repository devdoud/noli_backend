import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';
import { MediaService } from '../media/media.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('UsersService', () => {
  let service: UsersService;
  let mockUserModel: any;

  beforeEach(async () => {
    // ÉTAPE A: Créer le faux Model
    mockUserModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      find: jest.fn(),
      create: jest.fn()
    };

    // ÉTAPE B: Créer le module de test
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getModelToken(User.name),  // "Quand on demande User.name..."
          useValue: mockUserModel             // "...donne mockUserModel!"
        },
        {
          provide: MediaService,
          useValue: { replaceImage: jest.fn(), removeImage: jest.fn() }
        }
      ]
    }).compile();

    // ÉTAPE C: Récupérer le service
    service = module.get<UsersService>(UsersService);
  });

  // Les tests vont aller ici!

  describe('create', () => {
    it('should create a user successfully', async () => {
      // ARRANGE: Préparer les données
      const createUserDto = {
        email: 'john@example.com',
        username: 'john_doe',
        password: 'SecurePass123',
        firstName: 'John',
        lastName: 'Doe'
      };

      const createdUser = {
        _id: 'user-123',
        ...createUserDto,
        password: 'hashed_password_here',
        role: 'user',
        subscription: {
          plan: 'free',
          isActive: true,
          startDate: new Date()
        },
        toObject: jest.fn().mockReturnValue({
          _id: 'user-123',
          email: 'john@example.com',
          username: 'john_doe',
          firstName: 'John',
          lastName: 'Doe',
          role: 'user',
          subscription: {
            plan: 'free',
            isActive: true,
            startDate: new Date()
          }
        })
      };

      // Configurer le mock: "L'email n'existe pas encore"
      mockUserModel.findOne.mockResolvedValue(null);

      // Configurer le mock: "Quand create est appelée, retourner createdUser"
      mockUserModel.create.mockResolvedValue(createdUser);

      // ACT: Exécuter la fonction
      const result = await service.create(createUserDto);

      // ASSERT: Vérifier
      expect(result).toEqual(createdUser.toObject());  // Résultat correct?
      expect(mockUserModel.findOne).toHaveBeenCalledTimes(2);  // Cherché email ET username?
      expect(mockUserModel.create).toHaveBeenCalled();  // Créé l'utilisateur?
    });

    it('should throw error if email already exists', async () => {
      const createUserDto = {
        email: 'existing@example.com',
        username: 'newuser',
        password: 'SecurePass123',
        firstName: 'Jane',
        lastName: 'Smith'
      };

      // Configurer le mock: "L'email existe déjà!"
      mockUserModel.findOne.mockResolvedValue({
        _id: 'existing-user',
        email: 'existing@example.com'
      });

      // Vérifier que ça lance une erreur
      await expect(service.create(createUserDto))
        .rejects
        .toThrow(ConflictException);
    });
  });

  describe('findByEmail', () => {
    it('should return a user when email is found', async () => {
      // ARRANGE
      const mockUser = {
        _id: 'user-123',
        email: 'john@example.com',
        username: 'john_doe',
        password: 'hashed_password'
      };

      // Configurer le mock avec le chaînage .select()
      const mockChain = {
        select: jest.fn().mockResolvedValue(mockUser)
      };
      mockUserModel.findOne.mockReturnValue(mockChain);

      // ACT
      const result = await service.findByEmail('john@example.com');

      // ASSERT
      expect(result).toEqual(mockUser);
      expect(mockUserModel.findOne).toHaveBeenCalledWith({ email: 'john@example.com' });
    });

    it('should throw NotFoundException if user not found', async () => {
      // ARRANGE: Mock retourne null (pas d'utilisateur)
      const mockChain = {
        select: jest.fn().mockResolvedValue(null)
      };
      mockUserModel.findOne.mockReturnValue(mockChain);

      // ACT & ASSERT
      await expect(service.findByEmail('nonexistent@example.com'))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('findById', () => {
    it('should return a user by ID', async () => {
      // ARRANGE
      const mockUser: any = {
        _id: 'user-123',
        email: 'john@example.com',
        username: 'john_doe',
        toObject: jest.fn().mockReturnValue({
          _id: 'user-123',
          email: 'john@example.com',
          username: 'john_doe'
        })
      };

      // Configurer le mock
      mockUserModel.findById.mockResolvedValue(mockUser);

      // ACT
      const result = await service.findById('user-123');

      // ASSERT
      expect(result).toEqual(mockUser.toObject());
      expect(mockUserModel.findById).toHaveBeenCalledWith('user-123');
    });

    it('should throw NotFoundException if user not found', async () => {
      // ARRANGE
      mockUserModel.findById.mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.findById('nonexistent-id'))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      // ARRANGE
      const mockUsers = [
        {
          _id: 'user-1',
          email: 'john@example.com',
          username: 'john_doe'
        },
        {
          _id: 'user-2',
          email: 'jane@example.com',
          username: 'jane_smith'
        }
      ];

      // Mock le chaînage find().lean().exec()
      const mockChain = {
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockUsers)
      };
      mockUserModel.find.mockReturnValue(mockChain);

      // ACT
      const result = await service.findAll();

      // ASSERT
      expect(result).toEqual(mockUsers);
      expect(result).toHaveLength(2);
      expect(mockUserModel.find).toHaveBeenCalled();
    });
  });

  describe('avatar (spec 0005 AC-4, AC-7)', () => {
    const media = () => (service as any).mediaService;
    const freshUser = (avatar?: string) => ({
      toObject: () => ({ _id: 'user-1', avatar }),
    });

    it('setAvatar reads the user fresh and saves with a compare and set filter', async () => {
      mockUserModel.findById.mockResolvedValue(freshUser('https://old'));
      mockUserModel.findOneAndUpdate = jest.fn(() => ({
        lean: () => ({ exec: jest.fn().mockResolvedValue({ _id: 'user-1' }) }),
      }));
      media().replaceImage.mockResolvedValue({ _id: 'user-1', avatar: 'https://new' });
      const file = { buffer: Buffer.from('x') } as Express.Multer.File;

      await service.setAvatar('user-1', file);

      expect(mockUserModel.findById).toHaveBeenCalledWith('user-1');
      const opts = media().replaceImage.mock.calls[0][0];
      expect(opts).toMatchObject({
        file,
        slot: 'userAvatar',
        owner: { userId: 'user-1' },
        currentUrl: 'https://old',
      });
      await opts.save('https://old', 'https://new');
      expect(mockUserModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'user-1', avatar: 'https://old' },
        { $set: { avatar: 'https://new' } },
        { new: true },
      );
    });

    it('removeAvatar clears to null; an account without avatar is passed as an empty slot', async () => {
      mockUserModel.findById.mockResolvedValue(freshUser(undefined));
      media().removeImage.mockResolvedValue({ _id: 'user-1' });

      await service.removeAvatar('user-1');

      expect(media().removeImage.mock.calls[0][0]).toMatchObject({
        slot: 'userAvatar',
        owner: { userId: 'user-1' },
        currentUrl: null,
      });
    });
  });
});