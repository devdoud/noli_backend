import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  PASSWORD_FORGOT_THROTTLER,
  PASSWORD_VERIFY_THROTTLER,
  UPLOAD_THROTTLER,
} from '../../throttler.config';
import { LoginResponseDto } from '../dto/auth-response.dto';
import {
  ForgotPasswordDto,
  ForgotPasswordResponseDto,
  ResetPasswordDto,
  VerifyResetCodeDto,
  VerifyResetCodeResponseDto,
} from './dto/password-reset.dto';
import { invalidCode } from './password-reset.errors';
import { FORGOT_MESSAGE, PasswordResetService } from './password-reset.service';

// Forgot password (spec 0007). All routes are public; ownership is proven by
// the emailed code, then by the reset token. The two first routes count per
// IP with the stock ThrottlerGuard, each against its own throttler only.
@ApiTags('Auth')
@Controller('auth/password')
export class PasswordResetController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  @ApiOperation({
    summary: 'Mot de passe oublié : demander un code',
    description:
      'Envoie un code à 6 chiffres valable 15 minutes à l’email, si un compte existe. La réponse est toujours la même, que le compte existe ou non. Une nouvelle demande annule le code précédent. Limites silencieuses : 1 par minute, 5 par heure et 10 par jour pour un même compte.',
  })
  @ApiResponse({
    status: 200,
    description: 'Demande prise en compte',
    type: ForgotPasswordResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Email mal formé' })
  @ApiResponse({
    status: 429,
    description: 'Plus de 20 demandes par heure depuis cette adresse IP',
  })
  @ApiResponse({
    status: 503,
    description: 'Service email indisponible (code MAIL_UNAVAILABLE)',
  })
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ [UPLOAD_THROTTLER]: true, [PASSWORD_VERIFY_THROTTLER]: true })
  @HttpCode(HttpStatus.OK)
  @Post('forgot')
  forgot(@Body() dto: ForgotPasswordDto) {
    this.passwordResetService.requestReset(dto.email);
    return { message: FORGOT_MESSAGE };
  }

  @ApiOperation({
    summary: 'Mot de passe oublié : vérifier le code',
    description:
      'Échange le bon code contre un jeton de réinitialisation valable 10 minutes, utilisable une seule fois. 5 codes faux annulent la demande. Toute erreur répond la même chose : 400 INVALID_OR_EXPIRED_CODE.',
  })
  @ApiBody({ type: VerifyResetCodeDto })
  @ApiResponse({
    status: 200,
    description: 'Code vérifié',
    type: VerifyResetCodeResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Code invalide ou expiré (code INVALID_OR_EXPIRED_CODE)',
  })
  @ApiResponse({
    status: 429,
    description: 'Plus de 30 vérifications par heure depuis cette adresse IP',
  })
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ [UPLOAD_THROTTLER]: true, [PASSWORD_FORGOT_THROTTLER]: true })
  @HttpCode(HttpStatus.OK)
  @Post('verify-code')
  async verifyCode(@Body() body: Record<string, unknown>) {
    // The body is typed as a plain object so the global ValidationPipe
    // leaves it alone: any invalid input must answer the uniform error.
    const dto = plainToInstance(VerifyResetCodeDto, body ?? {});
    const errors = await validate(dto);
    if (errors.length > 0) {
      throw invalidCode();
    }
    const { resetToken, expiresAt } =
      await this.passwordResetService.verifyCode(dto.email, dto.code);
    return { message: 'Code vérifié', resetToken, expiresAt };
  }

  @ApiOperation({
    summary: 'Mot de passe oublié : choisir le nouveau mot de passe',
    description:
      'Change le mot de passe avec le jeton reçu de verify-code, déconnecte toutes les autres sessions et renvoie de nouveaux tokens (même forme que /auth/login). Un email confirme le changement.',
  })
  @ApiResponse({
    status: 200,
    description: 'Mot de passe réinitialisé',
    type: LoginResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Jeton invalide, expiré ou déjà utilisé (code INVALID_OR_EXPIRED_TOKEN), ou mot de passe hors de 6 à 72 caractères',
  })
  @HttpCode(HttpStatus.OK)
  @Post('reset')
  async reset(@Body() dto: ResetPasswordDto) {
    const { accessToken, refreshToken, user } =
      await this.passwordResetService.resetPassword(
        dto.resetToken,
        dto.newPassword,
      );
    return {
      message: 'Mot de passe réinitialisé',
      accessToken,
      refreshToken,
      user,
    };
  }
}
