import { UseGuards, UseInterceptors, applyDecorators } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UploadThrottlerGuard } from './upload-throttler.guard';
import { MAX_IMAGE_BYTES } from './image-slots';

// Every image route (PUT and DELETE): JWT first, then the shared per user
// rate limit, so 401 always comes before 429.
export function ImageRoute() {
  return applyDecorators(
    UseGuards(JwtAuthGuard, UploadThrottlerGuard),
    ApiBearerAuth('JWT-auth'),
    ApiResponse({ status: 401, description: 'Non authentifié' }),
    ApiResponse({
      status: 429,
      description: 'Trop de requêtes images (10 par 10 minutes)',
    }),
  );
}

// The multipart part of an upload route. Nest's FileInterceptor maps a file
// over the limit to 413 and a wrong field name or extra file to 400.
export function ImageUpload() {
  return applyDecorators(
    UseInterceptors(
      FileInterceptor('file', {
        limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
      }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        properties: { file: { type: 'string', format: 'binary' } },
        required: ['file'],
      },
    }),
    ApiResponse({
      status: 400,
      description:
        'Fichier manquant, illisible, trop petit, trop étiré ou plus de 25 mégapixels',
    }),
    ApiResponse({ status: 413, description: 'Fichier de plus de 5 Mo' }),
    ApiResponse({
      status: 415,
      description: 'Pas un JPEG, PNG ou WebP, ou image animée',
    }),
    ApiResponse({ status: 503, description: 'Service d’images indisponible' }),
  );
}
