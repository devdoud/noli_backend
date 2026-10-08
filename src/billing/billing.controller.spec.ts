import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { KkiapayWebhookDto } from './dto/kkiapay-webhook.dto';

describe('BillingController', () => {
  let controller: BillingController;
  let mockBillingService: any;
  let mockConfigService: any;

  const dto: KkiapayWebhookDto = {
    transactionId: 'tx-1',
    event: 'transaction.success',
    isPaymentSucces: true,
    amount: 1000,
  };

  beforeEach(async () => {
    mockBillingService = {
      handleWebhook: jest.fn().mockResolvedValue(undefined),
      createPendingCheckout: jest.fn(),
    };

    mockConfigService = {
      getOrThrow: jest.fn().mockReturnValue('the-real-secret'),
      get: jest.fn().mockReturnValue('development'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: mockBillingService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<BillingController>(BillingController);
  });

  describe('webhook (AC-4)', () => {
    it('accepts a request whose signature matches and processes it', async () => {
      const result = await controller.webhook('the-real-secret', dto);

      expect(result).toEqual({ received: true });
      expect(mockBillingService.handleWebhook).toHaveBeenCalledWith(dto);
    });

    it('rejects a request with a wrong signature and never processes it', async () => {
      await expect(controller.webhook('wrong-secret', dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockBillingService.handleWebhook).not.toHaveBeenCalled();
    });

    it('rejects a request with no signature header at all', async () => {
      await expect(controller.webhook(undefined, dto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockBillingService.handleWebhook).not.toHaveBeenCalled();
    });
  });

  describe('createDevPendingCheckout', () => {
    // req.user is the FULL User document (JwtStrategy.validate returns
    // UsersService.findById's result), keyed by _id, never userId. A mock shaped
    // like a JWT payload ({ user: { userId } }) would hide the bug this catches.
    it('creates a pending checkout for the real authenticated user (req.user._id)', async () => {
      mockBillingService.createPendingCheckout.mockResolvedValue({
        partnerId: 'p-1',
      });
      const req: any = { user: { _id: 'user-1', email: 'user@example.com', role: 'user' } };

      const result = await controller.createDevPendingCheckout(req, {
        expectedAmount: 1000,
      });

      expect(result.data).toEqual({ partnerId: 'p-1' });
      expect(mockBillingService.createPendingCheckout).toHaveBeenCalledWith(
        'user-1',
        1000,
      );
    });

    it('refuses to run in production', async () => {
      mockConfigService.get.mockReturnValue('production');
      const req: any = { user: { _id: 'user-1' } };

      await expect(
        controller.createDevPendingCheckout(req, { expectedAmount: 1000 }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockBillingService.createPendingCheckout).not.toHaveBeenCalled();
    });
  });
});
