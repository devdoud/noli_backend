import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DEVICE_PLATFORMS } from '../schemas/device.schema';
import type { DevicePlatform } from '../schemas/device.schema';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'Jeton FCM du téléphone' })
  @IsString()
  @Length(1, 4096)
  token!: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS, example: 'android' })
  @IsIn(DEVICE_PLATFORMS)
  platform!: DevicePlatform;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;
}

export class UnregisterDeviceDto {
  @ApiProperty({ description: 'Jeton FCM à retirer' })
  @IsString()
  @Length(1, 4096)
  token!: string;
}

export class UpdatePrefsDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  newEpisodes?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  newSeries?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  premium?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  payment?: boolean;
}

export class InboxQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
