import {
  IsString,
  IsArray,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
  ArrayMinSize,
  IsMongoId,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from './trim.transform';

export class CreateSeriesDto {
  @ApiProperty({ example: 'Breaking Bad' })
  @Trim()
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({ example: 'A chemistry teacher turned drug lord.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/cover.jpg' })
  @IsString()
  @IsOptional()
  coverImage?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/banner.jpg' })
  @IsString()
  @IsOptional()
  bannerImage?: string;

  @ApiProperty({
    example: ['665f1b2c3d4e5f6789abcdef'],
    type: [String],
    description: 'Ids de catégories (au moins une, voir GET /categories)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  categoryIds!: string[];

  @ApiPropertyOptional({ example: ['English', 'French'], type: [String] })
  @IsArray()
  @IsOptional()
  languages?: string[];

  @ApiPropertyOptional({ example: 'USA' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: 2008 })
  @IsNumber()
  @IsOptional()
  releaseYear?: number;

  @ApiPropertyOptional({ enum: ['ongoing', 'completed'], example: 'completed' })
  @IsEnum(['ongoing', 'completed'])
  @IsOptional()
  status?: 'ongoing' | 'completed';

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: 'Série réservée aux abonnés premium',
  })
  @IsBoolean()
  @IsOptional()
  isPremium?: boolean;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    default: 0,
    description:
      "Nombre d'épisodes gratuits en aperçu, si la série est premium",
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  freeEpisodeCount?: number;
}
