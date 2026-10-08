import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { User } from '../../users/schemas/user.schema';
import { MailService } from '../../mail/mail.service';
import { DevicesService } from '../../notifications/devices.service';
import { AuthResponse, AuthService } from '../auth.service';
import { PasswordReset } from './password-reset.schema';
import {
  invalidCode,
  invalidResetToken,
  mailUnavailable,
} from './password-reset.errors';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const CODE_TTL_MS = 15 * MINUTE; // AC-1
const RESET_TOKEN_TTL_MS = 10 * MINUTE; // AC-5
const MAX_ATTEMPTS = 5; // AC-7, per request
const MAX_WRONG_TRIES_PER_DAY = 15; // AC-7, per account
const RESEND_DELAY_MS = MINUTE; // AC-4
const MAX_REQUESTS_PER_HOUR = 5; // AC-4
const MAX_REQUESTS_PER_DAY = 10; // AC-4
const DEFAULT_DAILY_CAP = 250; // AC-17
const MIN_SECRET_LENGTH = 32; // AC-18

export const FORGOT_MESSAGE =
  'Si un compte existe pour cet email, un code a été envoyé.';

// Forgot password flow (spec 0007): request a code by email, trade the right
// code for a single use reset token, trade the token for a new password.
@Injectable()
export class PasswordResetService implements OnModuleInit {
  private readonly logger = new Logger(PasswordResetService.name);
  private secret = '';

  constructor(
    @InjectModel(PasswordReset.name)
    private readonly resetModel: Model<PasswordReset>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly authService: AuthService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
    private readonly devices: DevicesService,
  ) {}

  // AC-18: refuse to boot with a missing, short, or reused secret.
  onModuleInit(): void {
    const secret = this.config.get<string>('PASSWORD_RESET_SECRET') ?? '';
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `PASSWORD_RESET_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters`,
      );
    }
    if (
      secret === this.config.get<string>('JWT_SECRET') ||
      secret === this.config.get<string>('JWT_REFRESH_SECRET')
    ) {
      throw new Error('PASSWORD_RESET_SECRET must differ from the JWT secrets');
    }
    this.secret = secret;
  }

  // POST /auth/password/forgot. Answers before any database or email work,
  // so neither the answer nor its timing depends on the account (AC-1, AC-2).
  requestReset(email: string): void {
    if (!this.mailService.isAvailable()) {
      throw mailUnavailable();
    }
    void this.processRequest(email).catch((error: unknown) => {
      this.logger.error(`password reset request failed: ${reason(error)}`);
    });
  }

  // The background half of /forgot. Every early return is a silent drop.
  async processRequest(email: string): Promise<void> {
    const now = Date.now();

    // AC-17: protect the email quota for everyone.
    const lastDay = await this.resetModel.countDocuments({
      createdAt: { $gt: new Date(now - DAY) },
    });
    if (lastDay >= this.dailyCap()) {
      this.logger.error('password reset dropped: daily cap reached');
      return;
    }

    const user = await this.userModel
      .findOne({ email })
      .select('_id email firstName')
      .lean<{ _id: Types.ObjectId; email: string; firstName?: string }>();
    if (!user) return;

    // AC-4: per account limits. Every request counts, whatever its status.
    const [perHour, perDay, latest] = await Promise.all([
      this.resetModel.countDocuments({
        userId: user._id,
        createdAt: { $gt: new Date(now - HOUR) },
      }),
      this.resetModel.countDocuments({
        userId: user._id,
        createdAt: { $gt: new Date(now - DAY) },
      }),
      this.resetModel
        .findOne({ userId: user._id })
        .sort({ createdAt: -1 })
        .select('createdAt')
        .lean(),
    ]);
    if (
      perHour >= MAX_REQUESTS_PER_HOUR ||
      perDay >= MAX_REQUESTS_PER_DAY ||
      (latest && now - latest.createdAt.getTime() < RESEND_DELAY_MS)
    ) {
      this.logger.log(
        `password reset dropped: limit reached for user ${user._id.toString()}`,
      );
      return;
    }

    // Insert first, then cancel every other live request: two concurrent
    // requests always end with only the newest one live (AC-3).
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const _id = new Types.ObjectId();
    await this.resetModel.create({
      _id,
      userId: user._id,
      codeHash: this.codeHash(_id, code),
      expiresAt: new Date(now + CODE_TTL_MS),
    });
    await this.resetModel.updateMany(
      {
        userId: user._id,
        _id: { $ne: _id },
        status: { $in: ['pending', 'verified'] },
      },
      { status: 'cancelled' },
    );
    this.logger.log(`password reset requested for user ${user._id.toString()}`);

    try {
      await this.mailService.sendPasswordResetCode(
        user._id.toString(),
        user.email,
        user.firstName,
        code,
      );
    } catch (error) {
      this.logger.error(
        `password reset email failed for user ${user._id.toString()}: ${reason(error)}`,
      );
    }
  }

  // POST /auth/password/verify-code (AC-5, AC-6, AC-7). The same queries and
  // the same HMAC run whether the account exists or not.
  async verifyCode(
    email: string,
    code: string,
  ): Promise<{ resetToken: string; expiresAt: string }> {
    const now = Date.now();
    const user = await this.userModel
      .findOne({ email })
      .select('_id')
      .lean<{ _id: Types.ObjectId }>();
    const userId = user?._id ?? new Types.ObjectId();

    const [latest, tries] = await Promise.all([
      this.resetModel.findOne({ userId }).sort({ createdAt: -1 }).lean(),
      this.resetModel.aggregate<{ total: number }>([
        { $match: { userId, createdAt: { $gt: new Date(now - DAY) } } },
        { $group: { _id: null, total: { $sum: '$attempts' } } },
      ]),
    ]);
    const given = this.codeHash(latest?._id ?? userId, code);

    if (
      !user ||
      !latest ||
      latest.status !== 'pending' ||
      latest.expiresAt.getTime() <= now ||
      latest.attempts >= MAX_ATTEMPTS ||
      (tries[0]?.total ?? 0) >= MAX_WRONG_TRIES_PER_DAY
    ) {
      throw invalidCode();
    }

    if (!sameHash(given, latest.codeHash)) {
      // Atomic, so concurrent wrong tries are all counted (AC-7).
      const after = await this.resetModel
        .findOneAndUpdate(
          { _id: latest._id, status: 'pending' },
          { $inc: { attempts: 1 } },
          { returnDocument: 'after' },
        )
        .lean();
      if (after && after.attempts >= MAX_ATTEMPTS) {
        await this.resetModel.updateOne(
          { _id: latest._id, status: 'pending' },
          { status: 'cancelled' },
        );
      }
      this.logger.log(
        `password reset wrong code for user ${user._id.toString()}`,
      );
      throw invalidCode();
    }

    const resetToken = randomBytes(32).toString('base64url');
    const resetTokenExpiresAt = new Date(now + RESET_TOKEN_TTL_MS);
    // Conditional: a concurrent 5th wrong try or a newer request wins.
    const verified = await this.resetModel.findOneAndUpdate(
      {
        _id: latest._id,
        status: 'pending',
        attempts: { $lt: MAX_ATTEMPTS },
        expiresAt: { $gt: new Date(now) },
      },
      {
        status: 'verified',
        verifiedAt: new Date(now),
        resetTokenHash: this.tokenHash(resetToken),
        resetTokenExpiresAt,
      },
    );
    if (!verified) {
      throw invalidCode();
    }
    this.logger.log(
      `password reset code verified for user ${user._id.toString()}`,
    );
    return { resetToken, expiresAt: resetTokenExpiresAt.toISOString() };
  }

  // POST /auth/password/reset (AC-8, AC-9, AC-10).
  async resetPassword(
    resetToken: unknown,
    newPassword: string,
  ): Promise<AuthResponse> {
    if (typeof resetToken !== 'string' || resetToken.length === 0) {
      throw invalidResetToken();
    }
    const now = new Date();
    const request = await this.resetModel
      .findOne({
        resetTokenHash: this.tokenHash(resetToken),
        status: 'verified',
        resetTokenExpiresAt: { $gt: now },
      })
      .lean();
    if (!request) {
      throw invalidResetToken();
    }

    // Hash before claiming, so a slow or failing hash never burns the token.
    const passwordHash = await bcrypt.hash(newPassword, 10);

    const claimed = await this.resetModel.findOneAndUpdate(
      {
        _id: request._id,
        status: 'verified',
        resetTokenExpiresAt: { $gt: now },
      },
      { status: 'used', usedAt: now },
    );
    if (!claimed) {
      throw invalidResetToken();
    }

    let user: User | null;
    try {
      user = await this.userModel.findOneAndUpdate(
        { _id: request.userId },
        {
          password: passwordHash,
          isEmailVerified: true,
          $inc: { tokenVersion: 1 },
        },
        { returnDocument: 'after' },
      );
    } catch (error) {
      // Give the token back so the user can retry with it.
      await this.resetModel.updateOne(
        { _id: request._id, status: 'used' },
        { status: 'verified', usedAt: null },
      );
      throw error;
    }
    if (!user) {
      // The account was deleted meanwhile; the request stays used.
      throw invalidResetToken();
    }

    this.logger.log(`password reset completed for user ${user._id.toString()}`);
    // Spec 0008 AC-16: a stolen phone stops receiving notifications too.
    try {
      await this.devices.removeAllForUser(user._id);
    } catch (error) {
      this.logger.error(
        `device purge failed for user ${user._id.toString()}: ${reason(error)}`,
      );
    }
    void this.mailService
      .sendPasswordChanged(user._id.toString(), user.email, user.firstName)
      .catch((error: unknown) => {
        this.logger.error(
          `password changed email failed for user ${user._id.toString()}: ${reason(error)}`,
        );
      });

    return this.authService.issueTokens(user.toObject({ versionKey: false }));
  }

  private dailyCap(): number {
    const value = Number(this.config.get<string>('MAIL_DAILY_CAP'));
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_DAILY_CAP;
  }

  // The request id binds a code to its own request (AC-15).
  private codeHash(requestId: Types.ObjectId, code: string): string {
    return this.hmac(`code:${requestId.toString()}:${code}`);
  }

  private tokenHash(token: string): string {
    return this.hmac(`token:${token}`);
  }

  private hmac(input: string): string {
    return createHmac('sha256', this.secret).update(input).digest('hex');
  }
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
