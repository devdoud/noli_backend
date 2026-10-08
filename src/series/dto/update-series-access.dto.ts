import { IsBoolean, IsInt, Min, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// ValidateIf instead of IsOptional: null is a 400 here, not a value that
// reaches the database's required check.
export class UpdateSeriesAccessDto {
  @ApiPropertyOptional({
    example: true,
    description: 'Série réservée aux abonnés premium',
  })
  @ValidateIf((o: UpdateSeriesAccessDto) => o.isPremium !== undefined)
  @IsBoolean()
  isPremium?: boolean;

  @ApiPropertyOptional({
    example: 3,
    minimum: 0,
    description:
      "Nombre d'épisodes gratuits en aperçu (ordre saison puis épisode), si la série est premium",
  })
  @ValidateIf((o: UpdateSeriesAccessDto) => o.freeEpisodeCount !== undefined)
  @IsInt()
  @Min(0)
  freeEpisodeCount?: number;
}
