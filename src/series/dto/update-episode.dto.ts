import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from './trim.transform';

// seasonNumber, episodeNumber and views aren't declared: they're frozen and
// the global whitelist strips them. videoUrl isn't either (spec 0006): a
// video is changed through the upload, import, and delete video routes.
export class UpdateEpisodeDto {
  @ApiPropertyOptional({ example: 'Pilote' })
  @ValidateIf((o: UpdateEpisodeDto) => o.title !== undefined)
  @Trim()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null pour effacer' })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    example: 3600,
    minimum: 1,
    description: 'Durée en secondes',
  })
  @ValidateIf((o: UpdateEpisodeDto) => o.duration !== undefined)
  @IsInt()
  @Min(1)
  duration?: number;

  @ApiPropertyOptional({ example: '2026-01-20T00:00:00.000Z' })
  @ValidateIf((o: UpdateEpisodeDto) => o.releaseDate !== undefined)
  @IsDateString()
  releaseDate?: string;
}

export const EDITABLE_EPISODE_FIELDS = [
  'title',
  'description',
  'duration',
  'releaseDate',
] as const;
