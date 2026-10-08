import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let controller: AppController;
  let service: AppService;

  beforeEach(async () => {
    const mockAppService = {
      getHello: jest.fn().mockReturnValue('Hello World!')
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: mockAppService
        }
      ]
    }).compile();

    controller = module.get<AppController>(AppController);
    service = module.get<AppService>(AppService);

    // Vérifier que le service est bien injecté
    expect(controller['appService']).toBeDefined();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should have appService', () => {
    expect(controller['appService']).toBeDefined();
  });

  describe('getHello', () => {
    it('should return "Hello World!"', () => {
      jest.spyOn(service, 'getHello').mockReturnValue('Hello World!');
      const result = controller.getHello();
      expect(result).toBe('Hello World!');
    });
  });
});