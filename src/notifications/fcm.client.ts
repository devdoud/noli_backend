import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';

export type PushMode = 'live' | 'dev' | 'off';

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
  account: boolean; // high priority and the 'account' Android channel
  collapseKey?: string;
  threadId?: string;
  badge: number;
}

export type TokenOutcome = 'ok' | 'invalid' | 'temporary';

// FCM error codes meaning the token will never work again (AC-11).
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const APP_NAME = 'noli-push';

// Firebase Cloud Messaging through firebase-admin (spec 0008). Without
// credentials: development and test log each push (dev mode, counts as
// sent); any other NODE_ENV sends nothing (off) and pushes stay unsent.
@Injectable()
export class FcmClient implements OnModuleInit {
  private readonly logger = new Logger(FcmClient.name);
  private app: App | null = null;
  private messaging: Messaging | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const encoded = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64');
    if (!encoded) {
      this.logger.warn(
        this.devMode()
          ? 'FIREBASE_SERVICE_ACCOUNT_BASE64 is not set: pushes are written to the log (dev mode)'
          : 'FIREBASE_SERVICE_ACCOUNT_BASE64 is not set: pushes are disabled',
      );
      return;
    }
    try {
      const account = JSON.parse(
        Buffer.from(encoded, 'base64').toString('utf8'),
      ) as Record<string, string>;
      this.app = initializeApp({ credential: cert(account) }, APP_NAME);
      this.messaging = getMessaging(this.app);
    } catch (error) {
      this.logger.error(
        `Firebase credentials unreadable, pushes disabled: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) {
      await deleteApp(this.app);
    }
  }

  mode(): PushMode {
    if (this.messaging) return 'live';
    return this.devMode() ? 'dev' : 'off';
  }

  // One outcome per token, in order. Never throws for a per token failure; a
  // failure of the whole call marks every token temporary.
  async send(
    userId: string,
    tokens: string[],
    message: PushMessage,
  ): Promise<TokenOutcome[]> {
    if (tokens.length === 0) return [];
    if (!this.messaging) {
      if (this.devMode()) {
        this.logger.warn(
          `[push:dev] user ${userId}, ${tokens.length} device(s): ${message.title} | ${message.body} ${JSON.stringify(message.data)}`,
        );
        return tokens.map(() => 'ok');
      }
      return tokens.map(() => 'temporary');
    }
    try {
      const res = await this.messaging.sendEachForMulticast({
        tokens,
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: {
          priority: message.account ? 'high' : 'normal',
          collapseKey: message.collapseKey,
          notification: {
            channelId: message.account ? 'account' : 'content',
            tag: message.collapseKey,
          },
        },
        apns: {
          payload: {
            aps: {
              badge: message.badge,
              threadId: message.threadId,
            },
          },
        },
      });
      return res.responses.map((r) => {
        if (r.success) return 'ok';
        return r.error && INVALID_TOKEN_CODES.has(r.error.code)
          ? 'invalid'
          : 'temporary';
      });
    } catch (error) {
      this.logger.error(
        `FCM call failed for user ${userId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return tokens.map(() => 'temporary');
    }
  }

  private devMode(): boolean {
    const env = this.config.get<string>('NODE_ENV');
    return env === 'development' || env === 'test';
  }
}
