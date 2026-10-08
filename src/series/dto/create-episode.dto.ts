import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from './trim.transform';

// Integers >= 1 so every created episode can be addressed by the integer path
// routes (play, edit, delete). releaseDate is an ISO string: a JSON body never
// carries a Date, so the old @IsDate always failed.
export class CreateEpisodeDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  episodeNumber!: number;

  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  seasonNumber!: number;

  @ApiProperty({ example: 'Pilot' })
  @Trim()
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({ example: 'Walter White meets Jesse Pinkman.' })
  @IsString()
  @IsOptional()
  description?: string;

  // Optional since spec 0006: give the episode a real video afterwards with
  // the upload or import routes. A pasted link still works (unprotected).
  @ApiPropertyOptional({
    example: 'https://cdn.example.com/episode1.mp4',
    description:
      'Lien vidéo hébergé ailleurs (ancien mode, non protégé). Préférer les routes video/upload ou video/import.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  videoUrl?: string;

  @ApiProperty({
    example: 3600,
    minimum: 1,
    description: 'Duration in seconds',
  })
  @IsInt()
  @Min(1)
  duration!: number;

  @ApiPropertyOptional({ example: '2008-01-20T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  releaseDate?: string;
}
