import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUrl, Max, Min } from 'class-validator';

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

export class ImportVideoDto {
  @ApiProperty({
    example: 'https://cdn.example.com/episode1.mp4',
    description:
      'Lien public https du fichier vidéo ; Cloudflare le télécharge lui même.',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url!: string;
}
