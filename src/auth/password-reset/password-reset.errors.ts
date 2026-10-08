import { HttpException, HttpStatus } from '@nestjs/common';

// The exact error bodies of spec 0007 (AC-6, AC-10, AC-14). Each one is the
// same whatever went wrong, so an answer never tells an attacker why.

export function invalidCode(): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.BAD_REQUEST,
      code: 'INVALID_OR_EXPIRED_CODE',
      message: 'Code invalide ou expiré',
    },
    HttpStatus.BAD_REQUEST,
  );
}

export function invalidResetToken(): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.BAD_REQUEST,
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: 'Session de réinitialisation invalide ou expirée',
    },
    HttpStatus.BAD_REQUEST,
  );
}

export function mailUnavailable(): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'MAIL_UNAVAILABLE',
      message: 'Service email indisponible',
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
