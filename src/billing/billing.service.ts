import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { PendingCheckout } from './schemas/pending-checkout.schema';
import {
  WebhookEvent,
  WebhookEventOutcome,
} from './schemas/webhook-event.schema';
import { User } from '../users/schemas/user.schema';
import { KkiapayService, KkiapayVerifyResult } from './kkiapay.service';
import { KkiapayWebhookDto } from './dto/kkiapay-webhook.dto';
import { BILLING_PERIOD_MS } from './billing.constants';
import { NotificationsService } from '../notifications/notifications.service';
import {
  paymentFailedText,
  paymentSucceededText,
} from '../notifications/templates/fr';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectModel(PendingCheckout.name)
    private readonly pendingCheckoutModel: Model<PendingCheckout>,
    @InjectModel(WebhookEvent.name)
    private readonly webhookEventModel: Model<WebhookEvent>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly kkiapayService: KkiapayService,
    private readonly notifications: NotificationsService,
  ) {}

  // AC-1..AC-7 orchestration. Everything after the WebhookEvent claim runs inside
  // one try/catch: any unexpected failure marks the event `failed` and surfaces as
  // a 500, so KkiaPay's own retry redelivers it (AC-7) instead of it being lost.
  async handleWebhook(dto: KkiapayWebhookDto): Promise<void> {
    const event = await this.claimWebhookEvent(dto);
    if (event.alreadyProcessed) {
      return;
    }

    try {
      const verified = await this.kkiapayService.verify(dto.transactionId);

      if (verified.status !== 'SUCCESS') {
        await this.markRejected(event.id, 'rejected_failed', verified);
        await this.notifyPaymentFailed(verified.partnerId, dto.transactionId);
        this.logger.warn(
          `Transaction ${dto.transactionId} verified as FAILED, no credit applied`,
        );
        return;
      }

      const checkout = await this.claimPendingCheckout(
        verified.partnerId,
        dto.transactionId,
      );
      if (!checkout) {
        await this.markRejected(event.id, 'no_pending_checkout', verified);
        this.logger.warn(
          `No unconsumed PendingCheckout for partnerId ${verified.partnerId}`,
        );
        return;
      }

      if (verified.amount !== checkout.expectedAmount) {
        await this.markRejected(
          event.id,
          'rejected_mismatch',
          verified,
          checkout.userId,
        );
        this.logger.warn(
          `Amount mismatch on transaction ${dto.transactionId}: expected ${checkout.expectedAmount}, verified ${verified.amount}`,
        );
        return;
      }

      const wasReactivation = await this.wasUserInactive(checkout.userId);
      const endDate = await this.creditSubscription(
        checkout.userId,
        dto.transactionId,
      );
      // Spec 0008 AC-7: before markCredited, so a lost notification can never
      // sit behind an event already marked processed (the dedupe key makes a
      // retried webhook add nothing).
      await this.notifyPaymentSucceeded(
        checkout.userId,
        dto.transactionId,
        endDate,
      );
      await this.markCredited(
        event.id,
        verified,
        checkout.userId,
        wasReactivation,
      );
      this.logger.log(
        `Credited user ${checkout.userId.toString()} via transaction ${dto.transactionId}`,
      );
    } catch (err) {
      await this.markFailed(event.id);
      this.logger.error(
        `Webhook processing failed for transaction ${dto.transactionId}`,
        err as Error,
      );
      throw new InternalServerErrorException('Webhook processing failed');
    }
  }

  // Dev/test only: seeds a PendingCheckout directly (feature 3 will do this for real
  // at checkout initiation), so the webhook thread can be exercised end to end
  // before feature 3 exists. Production gating lives in the controller.
  async createPendingCheckout(
    userId: string,
    expectedAmount: number,
  ): Promise<PendingCheckout> {
    // Types.ObjectId(undefined) silently mints a fresh, unrelated id instead of
    // throwing, so a bad caller (e.g. reading the wrong field off req.user) would
    // otherwise create a checkout for nobody without any error. Fail loudly instead.
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('A valid userId is required to create a pending checkout');
    }

    return this.pendingCheckoutModel.create({
      partnerId: randomUUID(),
      userId: new Types.ObjectId(userId),
      expectedAmount,
    });
  }

  // The unique index insert at status='received' IS the idempotency claim (AC-6).
  // A duplicate key means this transactionId was already seen: a 'processed' row
  // short circuits, a 'received'/'failed' row means an earlier attempt didn't
  // finish, so we resume against that same row instead of re-claiming.
  private async claimWebhookEvent(
    dto: KkiapayWebhookDto,
  ): Promise<{ id: Types.ObjectId; alreadyProcessed: boolean }> {
    try {
      const created = await this.webhookEventModel.create({
        transactionId: dto.transactionId,
        kkiapayEvent: dto.event,
        status: 'received',
        payload: dto as unknown as Record<string, unknown>,
        receivedAt: new Date(),
      });
      return { id: created._id, alreadyProcessed: false };
    } catch (err) {
      if (!this.isDuplicateKeyError(err)) {
        throw err;
      }
      const existing = await this.webhookEventModel.findOne({
        transactionId: dto.transactionId,
      });
      if (!existing) {
        throw err;
      }
      return {
        id: existing._id,
        alreadyProcessed: existing.status === 'processed',
      };
    }
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: number }).code === 11000
    );
  }

  // Atomic claim (findOneAndUpdate on consumedAt: null), resume-safe: a retry of the
  // SAME transactionId can re-claim a checkout it already consumed (so reprocessing
  // never gets stuck as "no_pending_checkout"), but a different transaction cannot.
  private async claimPendingCheckout(
    partnerId: string,
    transactionId: string,
  ): Promise<PendingCheckout | null> {
    return this.pendingCheckoutModel.findOneAndUpdate(
      {
        partnerId,
        $or: [{ consumedAt: null }, { consumedByTransactionId: transactionId }],
      },
      {
        $set: {
          consumedAt: new Date(),
          consumedByTransactionId: transactionId,
        },
      },
      { new: true },
    );
  }

  // Audit-only read (per spec: "computed server side, never trusted from client input").
  // A stale read here only affects the wasReactivation log field, never the credit
  // itself, which the atomic update below computes fresh from the document's own state.
  private async wasUserInactive(userId: Types.ObjectId): Promise<boolean> {
    const user = await this.userModel
      .findById(userId)
      .select('subscription.isActive')
      .lean();
    return !(user?.subscription?.isActive ?? false);
  }

  // Single atomic pipeline update: endDate always stacks onto max(endDate, now), and
  // the lastTransactionId != transactionId filter makes this idempotent on its own,
  // so a retried credit after a crash between this write and markCredited is a no-op,
  // never a double credit. No client-supplied "new vs renewal" branch (AC-1).
  // Returns the subscription end date after the credit (re read when the
  // credit was already applied by an earlier delivery), for the payment
  // notification (spec 0008).
  private async creditSubscription(
    userId: Types.ObjectId,
    transactionId: string,
  ): Promise<Date | null> {
    const now = new Date();

    await this.userModel.updateOne(
      { _id: userId, 'subscription.lastTransactionId': { $ne: transactionId } },
      [
        {
          $set: {
            'subscription.plan': 'premium',
            'subscription.isActive': true,
            'subscription.startDate': {
              $cond: [
                { $eq: ['$subscription.isActive', false] },
                now,
                '$subscription.startDate',
              ],
            },
            'subscription.endDate': {
              $add: [
                { $max: ['$subscription.endDate', now] },
                BILLING_PERIOD_MS,
              ],
            },
            'subscription.lastTransactionId': transactionId,
          },
        },
      ],
    );
    const user = await this.userModel
      .findById(userId)
      .select('subscription.endDate')
      .lean();
    return user?.subscription?.endDate ?? null;
  }

  // Spec 0008: never throws, a notification failure must not fail the webhook.
  private async notifyPaymentSucceeded(
    userId: Types.ObjectId,
    transactionId: string,
    endDate: Date | null,
  ): Promise<void> {
    try {
      await this.notifications.createDirect({
        userId,
        type: 'payment_succeeded',
        ...paymentSucceededText(endDate),
        data: endDate ? { endDate: endDate.toISOString() } : {},
        dedupeKey: `payment_succeeded:${transactionId}`,
      });
    } catch (err) {
      this.logger.error(
        `payment_succeeded notification failed for transaction ${transactionId}`,
        err as Error,
      );
    }
  }

  // The failed transaction's user comes from the pending checkout with the
  // same partnerId, read without consuming it. No checkout, no notification.
  private async notifyPaymentFailed(
    partnerId: string | undefined,
    transactionId: string,
  ): Promise<void> {
    if (!partnerId) return;
    try {
      const checkout = await this.pendingCheckoutModel
        .findOne({ partnerId })
        .select('userId')
        .lean();
      if (!checkout) return;
      await this.notifications.createDirect({
        userId: checkout.userId,
        type: 'payment_failed',
        ...paymentFailedText(),
        dedupeKey: `payment_failed:${transactionId}`,
      });
    } catch (err) {
      this.logger.error(
        `payment_failed notification failed for transaction ${transactionId}`,
        err as Error,
      );
    }
  }

  private async markRejected(
    id: Types.ObjectId,
    outcome: WebhookEventOutcome,
    verified: KkiapayVerifyResult,
    userId?: Types.ObjectId,
  ): Promise<void> {
    await this.webhookEventModel.updateOne(
      { _id: id },
      {
        $set: {
          status: 'processed',
          outcome,
          partnerId: verified.partnerId,
          verifiedAmount: verified.amount,
          ...(userId ? { userId } : {}),
          processedAt: new Date(),
        },
      },
    );
  }

  private async markCredited(
    id: Types.ObjectId,
    verified: KkiapayVerifyResult,
    userId: Types.ObjectId,
    wasReactivation: boolean,
  ): Promise<void> {
    await this.webhookEventModel.updateOne(
      { _id: id },
      {
        $set: {
          status: 'processed',
          outcome: 'credited',
          partnerId: verified.partnerId,
          userId,
          verifiedAmount: verified.amount,
          wasReactivation,
          processedAt: new Date(),
        },
      },
    );
  }

  private async markFailed(id: Types.ObjectId): Promise<void> {
    await this.webhookEventModel.updateOne(
      { _id: id },
      { $set: { status: 'failed' } },
    );
  }
}
