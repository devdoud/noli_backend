import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  Request,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { BillingService } from './billing.service';
import { KkiapayWebhookDto } from './dto/kkiapay-webhook.dto';
import { CreateDevPendingCheckoutDto } from './dto/create-dev-pending-checkout.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Billing')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({
    summary: "Webhook KkiaPay : confirmation asynchrone d'une transaction",
  })
  @ApiHeader({
    name: 'x-kkiapay-secret',
    description: 'Secret configuré sur le dashboard KkiaPay',
  })
  @ApiResponse({
    status: 200,
    description: 'Événement reçu (traité, rejeté, ou ignoré selon le cas)',
  })
  @ApiResponse({ status: 401, description: 'Signature invalide' })
  @ApiResponse({
    status: 500,
    description: 'Échec de traitement, KkiaPay réessaiera',
  })
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Headers('x-kkiapay-secret') signature: string | undefined,
    @Body() dto: KkiapayWebhookDto,
  ): Promise<{ received: true }> {
    this.verifySignature(signature);
    await this.billingService.handleWebhook(dto);
    return { received: true };
  }

  @ApiOperation({
    summary: 'Créer un paiement en attente (développement uniquement)',
    description:
      'Seed un PendingCheckout directement, en attendant que la fonctionnalité de paiement (checkout) existe. Indisponible en production.',
  })
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({ status: 201, description: 'Paiement en attente créé' })
  @ApiResponse({ status: 401, description: 'Non authentifié' })
  @ApiResponse({ status: 403, description: 'Indisponible en production' })
  @Post('dev/pending-checkout')
  @UseGuards(JwtAuthGuard)
  async createDevPendingCheckout(
    @Request() req: any,
    @Body() body: CreateDevPendingCheckoutDto,
  ) {
    if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new ForbiddenException('Not available in production');
    }

    // req.user is the full User document (JwtStrategy.validate), keyed by
    // _id, not userId; see src/auth/AGENTS.md.
    const checkout = await this.billingService.createPendingCheckout(
      req.user._id.toString(),
      body.expectedAmount,
    );

    return {
      message: 'Pending checkout created',
      data: checkout,
    };
  }

  // Constant time comparison (AC-4): a length mismatch is rejected without ever
  // calling timingSafeEqual (which throws on unequal length buffers), and an equal
  // length comparison never short circuits on the first differing byte.
  private verifySignature(signature: string | undefined): void {
    const expected = this.configService.getOrThrow<string>(
      'KKIAPAY_WEBHOOK_SECRET',
    );
    const provided = Buffer.from(signature ?? '', 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');

    const isValid =
      provided.length === expectedBuffer.length &&
      timingSafeEqual(provided, expectedBuffer);

    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
