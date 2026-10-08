import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { UnauthorizedException } from '@nestjs/common';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;
  let configService: ConfigService;

  beforeEach(async () => {
    // Créer les mocks des services
    const mockUsersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      verifyPassword: jest.fn()
    };

    const mockJwtService = {
      sign: jest.fn(),
      verify: jest.fn()
    };

    const mockConfigService = {
      getOrThrow: jest.fn(),
      get: jest.fn()
    };

    // Créer le module de test
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: mockUsersService
        },
        {
          provide: JwtService,
          useValue: mockJwtService
        },
        {
          provide: ConfigService,
          useValue: mockConfigService
        }
      ]
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);
  });

  // Les tests vont ici!
    describe('login', () => {
    it('should return tokens and user on successful login', async () => {
      // ARRANGE
      const loginDto = {
        email: 'john@example.com',
        password: 'SecurePass123'
      };

      const mockUser = {
        _id: 'user-123',
        email: 'john@example.com',
        username: 'john_doe',
        password: 'hashed_password',
        role: 'user',
        subscription: { plan: 'free', isActive: true }
      };

      // Configurer les mocks
      (usersService.findByEmail as jest.Mock).mockResolvedValue(mockUser);
      (usersService.verifyPassword as jest.Mock).mockResolvedValue(true);
      (configService.getOrThrow as jest.Mock)
        .mockReturnValueOnce('secret-jwt-key')
        .mockReturnValueOnce('900')
        .mockReturnValueOnce('secret-refresh-key')
        .mockReturnValueOnce('2592000');
      
      (jwtService.sign as jest.Mock)
        .mockReturnValueOnce('access_token_123')
        .mockReturnValueOnce('refresh_token_456');

      // ACT
      const result = await service.login(loginDto);

      // ASSERT
      expect(result.accessToken).toBe('access_token_123');
      expect(result.refreshToken).toBe('refresh_token_456');
      expect(result.user.email).toBe('john@example.com');
      expect(result.user.id).toBe('user-123');
      expect(usersService.findByEmail).toHaveBeenCalledWith('john@example.com');
      expect(usersService.verifyPassword).toHaveBeenCalled();
    });


    it('should throw UnauthorizedException if email not found', async () => {
      // ARRANGE
      const loginDto = {
        email: 'nonexistent@example.com',
        password: 'AnyPassword'
      };

      // Configurer le mock pour lancer une erreur
      (usersService.findByEmail as jest.Mock)
        .mockRejectedValue(new Error('User not found'));

      // ACT & ASSERT
      await expect(service.login(loginDto))
        .rejects
        .toThrow(UnauthorizedException);
    });


    it('should throw UnauthorizedException if password is incorrect', async () => {
      // ARRANGE
      const loginDto = {
        email: 'john@example.com',
        password: 'WrongPassword'
      };

      const mockUser = {
        _id: 'user-123',
        email: 'john@example.com',
        password: 'hashed_password'
      };

      // Configurer les mocks
      (usersService.findByEmail as jest.Mock).mockResolvedValue(mockUser);
      (usersService.verifyPassword as jest.Mock).mockResolvedValue(false);  // ← Password faux!

      // ACT & ASSERT
      await expect(service.login(loginDto))
        .rejects
        .toThrow(UnauthorizedException);
    });
    
 });

   describe('refresh', () => {
    it('should return new access token on valid refresh token', async () => {
      // ARRANGE
      const refreshToken = 'valid_refresh_token_123';
      const mockUser = {
        _id: 'user-123',
        email: 'john@example.com',
        username: 'john_doe',
        role: 'user'
      };

      const payload = { userId: 'user-123' };

      // Configurer les mocks
      (jwtService.verify as jest.Mock).mockReturnValue(payload);
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);
      (configService.getOrThrow as jest.Mock)
        .mockReturnValueOnce('secret-jwt-key')
        .mockReturnValueOnce('900');
      (jwtService.sign as jest.Mock).mockReturnValue('new_access_token');

      // ACT
      const result = await service.refresh(refreshToken);

      // ASSERT
      expect(result.accessToken).toBe('new_access_token');
      expect(jwtService.verify).toHaveBeenCalledWith(refreshToken, {
        secret: undefined  // configService.get('JWT_REFRESH_SECRET') retourne undefined par défaut
      });
      expect(usersService.findById).toHaveBeenCalledWith('user-123');
    });

    
    it('should throw UnauthorizedException if refresh token is invalid', async () => {
      // ARRANGE
      const invalidToken = 'invalid_token';

      // Configurer le mock pour lancer une erreur
      (jwtService.verify as jest.Mock)
        .mockImplementation(() => {
          throw new Error('Invalid token');
        });

      // ACT & ASSERT
      await expect(service.refresh(invalidToken))
        .rejects
        .toThrow(UnauthorizedException);
    });
  });
});