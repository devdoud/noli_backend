import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Equals,
  IsInt,
  IsOptional,
  IsUrl,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

// Cloudflare Stream's own upload limit (spec 0006 AC-14).
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024 * 1024;

export class RequestVideoUploadDto {
  @ApiProperty({
    example: 157286400,
    minimum: 1,
    maximum: MAX_UPLOAD_BYTES,
    description:
      'Taille du fichier en octets. Jusqu’à 200 Mo : un envoi simple (method "post"). Au delà : un envoi reprenable (method "tus").',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_BYTES)
  uploadLength!: number;
}

// Exactly one of url or fromPastedLink (dashboard spec 0006): the controller
// refuses both or neither.
export class ImportVideoDto {
  @ApiPropertyOptional({
    example: 'https://cdn.example.com/episode1.mp4',
    description:
      'Lien public https du fichier vidéo ; Cloudflare le télécharge lui même.',
  })
  @ValidateIf((o: ImportVideoDto) => o.url !== undefined)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'Importer le lien collé déjà enregistré sur l’épisode (migration), sans le renvoyer.',
  })
  @IsOptional()
  @Equals(true)
  fromPastedLink?: boolean;
}
