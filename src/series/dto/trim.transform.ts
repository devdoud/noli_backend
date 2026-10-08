import { Transform } from 'class-transformer';

// Titles are trimmed before validation, so "   " fails @MinLength(1) at the
// pipe (400) instead of reaching Mongoose's `required` check (a 500).
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
