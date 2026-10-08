import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class KkiapayWebhookDto {
  @ApiProperty({ example: '3iH6wjHJ3' })
  @IsString()
  transactionId!: string;

  @ApiProperty({
    example: 'transaction.success',
    enum: ['transaction.success', 'transaction.failed'],
  })
  @IsIn(['transaction.success', 'transaction.failed'])
  event!: 'transaction.success' | 'transaction.failed';

  @ApiProperty({ example: true })
  @IsBoolean()
  isPaymentSucces!: boolean;

  @ApiPropertyOptional({ example: '22996000000', nullable: true })
  @IsOptional()
  @IsString()
  account?: string | null;

  @ApiPropertyOptional({ example: 'MOBILE_MONEY' })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiProperty({ example: 1000 })
  @IsNumber()
  amount!: number;

  @ApiPropertyOptional({ example: 19 })
  @IsOptional()
  @IsNumber()
  fees?: number;

  @ApiPropertyOptional({ example: 'a1b2c3' })
  @IsOptional()
  @IsString()
  partnerId?: string;

  @ApiPropertyOptional({ example: '2024-03-20T08:55:22.883Z' })
  @IsOptional()
  @IsString()
  performedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  stateData?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Present when event is transaction.failed',
  })
  @IsOptional()
  @IsString()
  failureCode?: string;

  @ApiPropertyOptional({
    description: 'Present when event is transaction.failed',
  })
  @IsOptional()
  @IsString()
  failureMessage?: string;
}
