import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BillingGraceScheduler } from './billing-grace.scheduler';
import { User } from '../users/schemas/user.schema';

describe('BillingGraceScheduler', () => {
  let scheduler: BillingGraceScheduler;
  let mockUserModel: any;

  beforeEach(async () => {
    mockUserModel = {
      updateMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingGraceScheduler,
        { provide: getModelToken(User.name), useValue: mockUserModel },
      ],
    }).compile();

    scheduler = module.get<BillingGraceScheduler>(BillingGraceScheduler);
  });

  describe('downgradeLapsedSubscriptions (AC-3)', () => {
    it('downgrades only subscriptions whose endDate is past the grace cutoff, in one atomic update', async () => {
      mockUserModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

      await scheduler.downgradeLapsedSubscriptions();

      expect(mockUserModel.updateMany).toHaveBeenCalledTimes(1);
      const [filter, update] = mockUserModel.updateMany.mock.calls[0];
      expect(filter['subscription.isActive']).toBe(true);
      expect(filter['subscription.endDate'].$lt).toBeInstanceOf(Date);
      expect(update.$set).toEqual({
        'subscription.plan': 'free',
        'subscription.isActive': false,
      });
    });

    it('never issues a second read or write; the filter itself is the race guard', async () => {
      mockUserModel.updateMany.mockResolvedValue({ modifiedCount: 0 });

      await scheduler.downgradeLapsedSubscriptions();

      expect(mockUserModel.updateMany).toHaveBeenCalledTimes(1);
    });
  });
});
