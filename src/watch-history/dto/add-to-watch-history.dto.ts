import { IsString, IsNumber, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddToWatchHistoryDto {
  @ApiProperty({ example: '665f1b2c3d4e5f6789abcdef' })
  @IsString()
  seriesId!: string;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsNumber()
  @Min(1)
  episodeNumber!: number;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsNumber()
  @Min(1)
  seasonNumber!: number;

  @ApiProperty({ example: 'Pilot' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({
    example: 1200,
    minimum: 0,
    description: 'Watched duration in seconds',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  watchedDuration?: number;

  @ApiPropertyOptional({
    example: 3600,
    minimum: 0,
    description: 'Total duration in seconds',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalDuration?: number;

  @ApiPropertyOptional({
    example: 33,
    minimum: 0,
    maximum: 100,
    description: 'Progress percentage 0-100',
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  progressPercentage?: number;
}
