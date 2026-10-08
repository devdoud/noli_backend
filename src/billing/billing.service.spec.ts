import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PendingCheckout } from './schemas/pending-checkout.schema';
import { WebhookEvent } from './schemas/webhook-event.schema';
import { User } from '../users/schemas/user.schema';
import { KkiapayService } from './kkiapay.service';
import { NotificationsService } from '../notifications/notifications.service';
import { KkiapayWebhookDto } from './dto/kkiapay-webhook.dto';

describe('BillingService', () => {
  let service: BillingService;
  let mockPendingCheckoutModel: any;
  let mockWebhookEventModel: any;
  let mockUserModel: any;
  let mockKkiapayService: any;

  const userId = new Types.ObjectId();
  const webhookEventId = new Types.ObjectId();

  const baseDto: KkiapayWebhookDto = {
    transactionId: 'tx-1',
    event: 'transaction.success',
    isPaymentSucces: true,
    amount: 1000,
    partnerId: 'partner-1',
  };

  beforeEach(async () => {
    mockPendingCheckoutModel = {
      create: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    mockWebhookEventModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({}),
    };

    mockUserModel = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      findById: jest.fn(),
    };

    mockKkiapayService = {
      verify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        {
          provide: getModelToken(PendingCheckout.name),
          useValue: mockPendingCheckoutModel,
        },
        {
          provide: getModelToken(WebhookEvent.name),
          useValue: mockWebhookEventModel,
        },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: KkiapayService, useValue: mockKkiapayService },
        {
          provide: NotificationsService,
          useValue: { createDirect: jest.fn().mockResolvedValue(true) },
        },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
  });

  // Sets the DB's CURRENT subscription.isActive value the service will read.
  // wasReactivation in the credited WebhookEvent is the negation of this.
  function mockCurrentIsActive(isActive: boolean) {
    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ subscription: { isActive } }),
      }),
    });
  }

  describe('handleWebhook: AC-1 credit path', () => {
    it('credits a first time subscriber and resets startDate', async () => {
      mockWebhookEventModel.create.mockResolvedValue({ _id: webhookEventId });
      mockKkiapayService.verify.mockResolvedValue({
        status: 'SUCCESS',
        amount: 1000,
        partnerId: 'partner-1',
        transactionId: 'tx-1',
      });
      mockPendingCheckoutModel.findOneAndUpdate.mockResolvedValue({
        userId,
        expectedAmount: 1000,
      });
      mockCurrentIsActive(false);

      await service.handleWebhook(baseDto);

      expect(mockUserModel.updateOne).toHaveBeenCalledWith(
        { _id: userId, 'subscription.lastTransactionId': { $ne: 'tx-1' } },
        expect.any(Array),
      );
      expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
        { _id: webhookEventId },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: 'processed',
            outcome: 'credited',
            wasReactivation: true,
          }),
        }),
      );
    });

    it('credits a renewal without treating it differently from a new subscription', async () => {
      mockWebhookEventModel.create.mockResolvedValue({ _id: webhookEventId });
      mockKkiapayService.verify.mockResolvedValue({
        status: 'SUCCESS',
        amount: 1000,
        partnerId: 'partner-1',
        transactionId: 'tx-1',
      });
      mockPendingCheckoutModel.findOneAndUpdate.mockResolvedValue({
        userId,
        expectedAmount: 1000,
      });
      mockCurrentIsActive(true);

      await service.handleWebhook(baseDto);

      expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
        { _id: webhookEventId },
        expect.objectContaining({
          $set: expect.objectContaining({
            outcome: 'credited',
            wasReactivation: false,
          }),
        }),
      );
    });
  });

  describe('handleWebhook: AC-2 rejection paths never alter subscription state', () => {
    it('rejects a verified FAILED transaction without touching the user', async () => {
      mockWebhookEventModel.create.mockResolvedValue({ _id: webhookEventId });
      mockKkiapayService.verify.mockResolvedValue({
        status: 'FAILED',
        amount: 1000,
        partnerId: 'partner-1',
        transactionId: 'tx-1',
      });

      await service.handleWebhook(baseDto);

      expect(mockUserModel.updateOne).not.toHaveBeenCalled();
      expect(mockPendingCheckoutModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
        { _id: webhookEventId },
        expect.objectContaining({
          $set: expect.objectContaining({ outcome: 'rejected_failed' }),
        }),
      );
    });

    it('rejects an amount mismatch without downgrading or crediting the user', async () => {
      mockWebhookEventModel.create.mockResolvedValue({ _id: webhookEventId });
      mockKkiapayService.verify.mockResolvedValue({
        status: 'SUCCESS',
        amount: 999,
        partnerId: 'partner-1',
        transactionId: 'tx-1',
      });
      mockPendingCheckoutModel.findOneAndUpdate.mockResolvedValue({
        userId,
        expectedAmount: 1000,
      });

      await service.handleWebhook(baseDto);

      expect(mockUserModel.updateOne).not.toHaveBeenCalled();
      expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
        { _id: webhookEventId },
        expect.objectContaining({
          $set: expect.objectContaining({
            outcome: 'rejected_mismatch',
            userId,
          }),
        }),
      );
    });
  });

  describe('handleWebhook: AC-5 no matching checkout', () => {
    it('logs and does not touch any subscription when no PendingCheckout matches', async () => {
      mockWebhookEventModel.create.mockResolvedValue({ _id: webhookEventId });
      mockKkiapayService.verify.mockResolvedValue({
        status: 'SUCCESS',
        amount: 1000,
        partnerId: 'unknown-partner',
        transactionId: 'tx-1',
      });
      mockPendingCheckoutModel.findOneAndUpdate.mockResolvedValue(null);

      await service.handleWebhook(baseDto);

      expect(mockUserModel.updateOne).not.toHaveBeenCalled();
      expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
        { _id: webhookEventId },
        expect.objectContaining({
          $set: expect.objectContaining({ outcome: 'no_pending_checkout' }),
        }),
      );
    });
  });

  describe('handleWebhook: AC-6 idempotent duplicate delivery', () => {
    it('short circuits a transactionId already marked processed, without reprocessing', async () => {
      const duplicateKeyError = Object.assign(new Error('duplicate'), {
        code: 11000,
      });
      mockWebhookEventModel.create.mockRejectedValue(duplicateKeyError);
      mockWebhookEventModel.findOne.mockResolvedValue({
        _id: webhookEventId,
        status: 'processed',
      });

      await service.handleWebhook(baseDto);

      expect(mockKkiapayService.verify).not.toHaveBeenCalled();
      expect(mockUserModel.updateOne).not.toHaveBeenCalled();
    });

    it('resumes a stuck received row instead of treating it as already handled', async () => {
      const duplicateKeyError = Object.assign(new Error('duplicate'), {
        code: 11000,
      });
      mockWebhookEventModel.create.mockRejectedValue(duplicateKeyError);
      mockWebhookEventModel.findOne.mockResolvedValue({
        _id: webhookEventId,
        status: 'received',
      });
      mockKkiapayService.verify.mockResolvedValue({
        status: 'SUCCESS',
        amount: 1000,
        partnerId: 'partner-1',
        transactionId: 'tx-1',
      });
      mockPendingCheckoutModel.findOneAndUpdate.mockResolvedValue({
        userId,
        expectedAmount: 1000,
      });
      mockCurrentIsActive(true);

      await service.handleWebhook(baseDto);

      expect(mockKkiapayService.verify).toHaveBeenCalledWith('tx-1');
      expect(mockUserModel.updateOne).toHaveBeenCalled();
    });

    it('claims PendingCheckout by transactionId (not just consumedAt: null) so a resumed retry never gets stuck', async () => {
      mockWebhookEventModel.create.mockResolvedValue({ _id: webhookEventId });
      mockKkiapayService.verify.mockResolvedValue({
        status: 'SUCCESS',
        amount: 1000,
        partnerId: 'partner-1',
        transactionId: 'tx-1',
      });
      mockPendingCheckoutModel.findOneAndUpdate.mockResolvedValue({
        userId,
        expectedAmount: 1000,
      });
      mockCurrentIsActive(true);

      await service.handleWebhook(baseDto);

      expect(mockPendingCheckoutModel.findOneAndUpdate).toHaveBeenCalledWith(
        {
          partnerId: 'partner-1',
          $or: [{ consumedAt: null }, { consumedByTransactionId: 'tx-1' }],
        },
        expect.objectContaining({
          $set: expect.objectContaining({ consumedByTransactionId: 'tx-1' }),
        }),
        { new: true },
      );
    });
  });

  describe('handleWebhook: AC-7 processing failure returns 500 and marks the event failed', () => {
    it('marks the WebhookEvent failed and throws when verify() errors', async () => {
      mockWebhookEventModel.create.mockResolvedValue({ _id: webhookEventId });
      mockKkiapayService.verify.mockRejectedValue(
        new Error('KkiaPay unreachable'),
      );

      await expect(service.handleWebhook(baseDto)).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
        { _id: webhookEventId },
        { $set: { status: 'failed' } },
      );
    });

    it('marks the WebhookEvent failed and throws when the credit write itself errors', async () => {
      mockWebhookEventModel.create.mockResolvedValue({ _id: webhookEventId });
      mockKkiapayService.verify.mockResolvedValue({
        status: 'SUCCESS',
        amount: 1000,
        partnerId: 'partner-1',
        transactionId: 'tx-1',
      });
      mockPendingCheckoutModel.findOneAndUpdate.mockResolvedValue({
        userId,
        expectedAmount: 1000,
      });
      mockCurrentIsActive(true);
      mockUserModel.updateOne.mockRejectedValue(new Error('db down'));

      await expect(service.handleWebhook(baseDto)).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(mockWebhookEventModel.updateOne).toHaveBeenCalledWith(
        { _id: webhookEventId },
        { $set: { status: 'failed' } },
      );
    });
  });

  describe('createPendingCheckout', () => {
    it('creates a PendingCheckout with a generated partnerId', async () => {
      mockPendingCheckoutModel.create.mockResolvedValue({
        partnerId: 'generated',
      });

      await service.createPendingCheckout(userId.toString(), 1000);

      expect(mockPendingCheckoutModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedAmount: 1000,
          partnerId: expect.any(String),
        }),
      );
    });

    it('rejects an invalid or missing userId instead of silently minting an unrelated one', async () => {
      await expect(service.createPendingCheckout(undefined as unknown as string, 1000)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.createPendingCheckout('not-an-object-id', 1000)).rejects.toThrow(BadRequestException);
      expect(mockPendingCheckoutModel.create).not.toHaveBeenCalled();
    });
  });
});
