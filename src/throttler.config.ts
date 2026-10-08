import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

// Every named throttler of the app lives here, registered once in AppModule
// (ThrottlerModule is global). Each guard only enforces the throttlers meant
// for its routes: UploadThrottlerGuard ignores the password ones, and the
// password routes skip the others with @SkipThrottle (spec 0007).
export const UPLOAD_THROTTLER = 'upload';
export const PASSWORD_FORGOT_THROTTLER = 'password-forgot';
export const PASSWORD_VERIFY_THROTTLER = 'password-verify';

const IMAGE_MESSAGE =
  'Trop de requêtes images, réessayez dans quelques minutes';
const PASSWORD_MESSAGE = 'Trop de tentatives, réessayez plus tard';

export const throttlerOptions: ThrottlerModuleOptions = {
  throttlers: [
    // Spec 0005 AC-11: 10 image calls per user every 10 minutes.
    { name: UPLOAD_THROTTLER, ttl: 600_000, limit: 10 },
    // Spec 0007 AC-13: per IP, one hour windows.
    { name: PASSWORD_FORGOT_THROTTLER, ttl: 3_600_000, limit: 20 },
    { name: PASSWORD_VERIFY_THROTTLER, ttl: 3_600_000, limit: 30 },
  ],
  errorMessage: (context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest<{ url?: string }>();
    return req.url?.startsWith('/auth/password')
      ? PASSWORD_MESSAGE
      : IMAGE_MESSAGE;
  },
};
