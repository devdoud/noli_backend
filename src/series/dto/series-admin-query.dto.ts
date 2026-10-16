import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { normalizeSearch } from '../title-search';

// Query of GET /series/admin (dashboard spec 0009). An invalid value is a 400,
// never a silently ignored filter.
export class SeriesAdminQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 20;

  @ApiPropertyOptional({
    example: 'mensah',
    description:
      'Titre contient ce texte, sans tenir compte des accents ni des majuscules (2 à 100 caractères)',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeSearch(value) : value,
  )
  @IsString()
  @Length(2, 100)
  q?: string;

  @ApiPropertyOptional({
    description: 'Une catégorie de la série, masquées comprises',
  })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description:
      'true : séries premium seulement ; false : gratuites seulement',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  premium?: 'true' | 'false';

  @ApiPropertyOptional({
    enum: ['todo'],
    description:
      'todo : séries ayant au moins un épisode dont la vidéo n’est pas prête ; chaque série porte alors videosToProcess',
  })
  @IsOptional()
  @IsIn(['todo'])
  video?: 'todo';
}
