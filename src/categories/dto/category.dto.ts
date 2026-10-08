import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SLUG_PATTERN } from '../slugify';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Comédie romantique', maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional({
    example: 'Des histoires d’amour qui font sourire.',
    maxLength: 300,
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/categories/comedie.jpg',
  })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;
}

// name, isVisible and slug use ValidateIf instead of IsOptional so that an
// explicit null is rejected; description and imageUrl accept null to clear them.
export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Comédies romantiques', maxLength: 50 })
  @ValidateIf((o: UpdateCategoryDto) => o.name !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ nullable: true, description: 'null pour effacer' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'null pour effacer' })
  @IsOptional()
  @IsUrl()
  imageUrl?: string | null;

  @ApiPropertyOptional({ example: false })
  @ValidateIf((o: UpdateCategoryDto) => o.isVisible !== undefined)
  @IsBoolean()
  isVisible?: boolean;

  @ApiPropertyOptional({
    example: 'comedies-romantiques',
    description:
      'Ne change que si fourni explicitement (renommer ne change pas le slug)',
  })
  @ValidateIf((o: UpdateCategoryDto) => o.slug !== undefined)
  @IsString()
  @Matches(SLUG_PATTERN)
  slug?: string;
}

export class ReorderCategoriesDto {
  @ApiProperty({
    type: [String],
    description:
      'Tous les ids de catégories, chacun une fois, dans le nouvel ordre',
  })
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  ids!: string[];
}

export class CategorySeriesQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 50, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;

  @ApiPropertyOptional({ enum: ['newest', 'rating'], default: 'newest' })
  @IsOptional()
  @IsIn(['newest', 'rating'])
  sort: 'newest' | 'rating' = 'newest';
}
