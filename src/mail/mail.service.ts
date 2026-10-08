import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailContent,
  passwordChangedEmail,
  passwordResetCodeEmail,
} from './templates/fr';

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';
const REQUEST_TIMEOUT_MS = 10_000;

// Transactional email through Brevo's HTTP API (spec 0007). Without a key,
// development and test write the reset code to the log instead (dev mode);
// any other NODE_ENV, unset included, has no mail at all.
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  // AC-18: a key without a sender would fail on every send; refuse to boot.
  onModuleInit(): void {
    if (this.apiKey() && !this.config.get<string>('MAIL_FROM_EMAIL')) {
      throw new Error('MAIL_FROM_EMAIL is required when BREVO_API_KEY is set');
    }
    if (!this.apiKey()) {
      this.logger.warn(
        this.devMode()
          ? 'BREVO_API_KEY is not set: emails are written to the log (dev mode)'
          : 'BREVO_API_KEY is not set: emails are disabled',
      );
    }
  }

  // True when a send can happen, for real or through the dev log.
  isAvailable(): boolean {
    return Boolean(this.apiKey()) || this.devMode();
  }

  async sendPasswordResetCode(
    userId: string,
    to: string,
    firstName: string | null | undefined,
    code: string,
  ): Promise<void> {
    if (!this.apiKey()) {
      if (this.devMode()) {
        this.logger.warn(
          `[mail:dev] password reset code for user ${userId}: ${code}`,
        );
      }
      return;
    }
    await this.send(to, passwordResetCodeEmail(code, firstName));
  }

  async sendPasswordChanged(
    userId: string,
    to: string,
    firstName: string | null | undefined,
  ): Promise<void> {
    if (!this.apiKey()) {
      this.logger.warn(
        this.devMode()
          ? `[mail:dev] password changed email for user ${userId}`
          : `password changed email not sent (no mail key) for user ${userId}`,
      );
      return;
    }
    await this.send(to, passwordChangedEmail(firstName));
  }

  // Throws on a non 2xx answer or a timeout; callers log with the user id.
  // The error never carries the address or the content.
  private async send(to: string, content: EmailContent): Promise<void> {
    let res: Response;
    try {
      res = await fetch(BREVO_SEND_URL, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey()!,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: {
            email: this.config.get<string>('MAIL_FROM_EMAIL'),
            name: this.config.get<string>('MAIL_FROM_NAME') || 'Noli',
          },
          to: [{ email: to }],
          subject: content.subject,
          htmlContent: content.html,
          textContent: content.text,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown';
      throw new Error(`Brevo request failed (${reason})`);
    }
    if (!res.ok) {
      throw new Error(`Brevo answered ${res.status}`);
    }
  }

  private apiKey(): string | undefined {
    return this.config.get<string>('BREVO_API_KEY') || undefined;
  }

  private devMode(): boolean {
    const env = this.config.get<string>('NODE_ENV');
    return env === 'development' || env === 'test';
  }
}
