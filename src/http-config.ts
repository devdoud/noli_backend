import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

// Browser origins allowed to call the API (spec 0009 AC-7), from the
// comma separated CORS_ORIGINS. Exact origins only, never a wildcard.
export function parseCorsOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

// Tokens travel in the Authorization header, so no credentials (cookies).
// An origin outside the list simply gets no CORS header.
export function corsOptions(origins: string[]): CorsOptions {
  return {
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
    maxAge: 600,
  };
}

// Public docs stay on unless SWAGGER_ENABLED is exactly 'false' (AC-8).
export function swaggerEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() !== 'false';
}
