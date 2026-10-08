import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Allow,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Trim and lowercase before @IsEmail runs (class-transformer runs first),
// matching how users.email is stored. Non strings pass through untouched so
// @IsString refuses them.
const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @Transform(normalizeEmail)
  @IsString()
  @IsEmail()
  email!: string;
}

// Not validated by the global pipe: the controller validates it itself so
// every invalid input answers the uniform INVALID_OR_EXPIRED_CODE (AC-6).
export class VerifyResetCodeDto {
  @ApiProperty({ example: 'user@example.com' })
  @Transform(normalizeEmail)
  @IsString()
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: '482913',
    description: 'Code à 6 chiffres reçu par email',
  })
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class ResetPasswordDto {
  // Checked in the handler (AC-10: a bad token answers the uniform
  // INVALID_OR_EXPIRED_TOKEN, not the DTO error list). @Allow keeps it
  // through the global whitelist.
  @ApiProperty({
    example: 'Qm9uam91ciBOb2xpIQ...',
    description: 'Jeton reçu de /auth/password/verify-code',
  })
  @Allow()
  resetToken!: unknown;

  // bcrypt ignores everything past 72 bytes (AC-11).
  @ApiProperty({ example: 'nouveauMotDePasse', minLength: 6, maxLength: 72 })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  @MaxLength(72, { message: 'Password must be at most 72 characters' })
  newPassword!: string;
}

export class ForgotPasswordResponseDto {
  @ApiProperty({
    example: 'Si un compte existe pour cet email, un code a été envoyé.',
  })
  message!: string;
}

export class VerifyResetCodeResponseDto {
  @ApiProperty({ example: 'Code vérifié' })
  message!: string;

  @ApiProperty({
    example: 'Qm9uam91ciBOb2xpIQ...',
    description: 'Valable 10 minutes, une seule fois',
  })
  resetToken!: string;

  @ApiProperty({ example: '2026-10-06T10:20:00.000Z' })
  expiresAt!: string;
}
