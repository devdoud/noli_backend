import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { kkiapay } from '@kkiapay-org/nodejs-sdk';

export interface KkiapayVerifyResult {
  status: 'SUCCESS' | 'FAILED';
  amount: number;
  partnerId: string;
  transactionId: string;
}

type KkiapayClient = ReturnType<typeof kkiapay>;

@Injectable()
export class KkiapayService {
  private client?: KkiapayClient;

  constructor(private readonly configService: ConfigService) {}

  // Built lazily, on first use, so a missing key fails when the SDK is actually
  // called rather than at app boot (matches the project's JWT ConfigService.getOrThrow convention).
  private getClient(): KkiapayClient {
    if (!this.client) {
      this.client = kkiapay({
        privatekey: this.configService.getOrThrow<string>(
          'KKIAPAY_PRIVATE_KEY',
        ),
        publickey: this.configService.getOrThrow<string>('KKIAPAY_PUBLIC_KEY'),
        secretkey: this.configService.getOrThrow<string>('KKIAPAY_SECRET_KEY'),
        sandbox: this.configService.get<string>('NODE_ENV') !== 'production',
      });
    }
    return this.client;
  }

  async verify(transactionId: string): Promise<KkiapayVerifyResult> {
    const result = await this.getClient().verify(transactionId);
    return {
      status: result.status,
      amount: result.amount,
      partnerId: result.partnerId,
      transactionId: result.transactionId,
    };
  }
}
