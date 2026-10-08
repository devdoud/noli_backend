import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from './trim.transform';

// Every field is optional. Fields that must not be null use ValidateIf (null
// fails validation); description, images and country accept null to clear.
// rating, votes, episodes and totalEpisodes aren't declared, so the global
// whitelist strips them.
export class UpdateSeriesDto {
  @ApiPropertyOptional({ example: 'Breaking Bad' })
  @ValidateIf((o: UpdateSeriesDto) => o.title !== undefined)
  @Trim()
  @IsString()
  @MinLength(1)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'https://cdn.example.com/cover.jpg',
  })
  @IsOptional()
  @IsString()
  coverImage?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'https://cdn.example.com/banner.jpg',
  })
  @IsOptional()
  @IsString()
  bannerImage?: string | null;

  @ApiPropertyOptional({ type: [String], example: ['Français', 'English'] })
  @ValidateIf((o: UpdateSeriesDto) => o.languages !== undefined)
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @ApiPropertyOptional({ nullable: true, example: 'Bénin' })
  @IsOptional()
  @IsString()
  country?: string | null;

  @ApiPropertyOptional({ example: 2024, minimum: 1888, maximum: 2100 })
  @ValidateIf((o: UpdateSeriesDto) => o.releaseYear !== undefined)
  @IsInt()
  @Min(1888)
  @Max(2100)
  releaseYear?: number;

  @ApiPropertyOptional({ enum: ['ongoing', 'completed'] })
  @ValidateIf((o: UpdateSeriesDto) => o.status !== undefined)
  @IsIn(['ongoing', 'completed'])
  status?: 'ongoing' | 'completed';

  @ApiPropertyOptional({
    type: [String],
    description: 'Ids de catégories (au moins une)',
  })
  @ValidateIf((o: UpdateSeriesDto) => o.categoryIds !== undefined)
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  categoryIds?: string[];

  @ApiPropertyOptional({ description: 'Série réservée aux abonnés premium' })
  @ValidateIf((o: UpdateSeriesDto) => o.isPremium !== undefined)
  @IsBoolean()
  isPremium?: boolean;

  @ApiPropertyOptional({
    minimum: 0,
    description: "Nombre d'épisodes gratuits en aperçu",
  })
  @ValidateIf((o: UpdateSeriesDto) => o.freeEpisodeCount !== undefined)
  @IsInt()
  @Min(0)
  freeEpisodeCount?: number;
}

export const EDITABLE_SERIES_FIELDS = [
  'title',
  'description',
  'coverImage',
  'bannerImage',
  'languages',
  'country',
  'releaseYear',
  'status',
  'categoryIds',
  'isPremium',
  'freeEpisodeCount',
] as const;
