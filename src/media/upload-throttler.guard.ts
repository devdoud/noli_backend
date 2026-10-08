import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import { UPLOAD_THROTTLER } from '../throttler.config';

// Counts per user, not per IP (shared mobile IPs are common), and uses one
// key for every image route so the limit is shared across all of them
// (spec 0005 AC-11). The default key includes the controller and handler
// names, which would give each route its own counter. Always runs after
// JwtAuthGuard, so req.user is set.
@Injectable()
export class UploadThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: {
    user?: { _id?: { toString(): string } | string };
    ip?: string;
  }): Promise<string> {
    // _id is an ObjectId, whose toString() is the hex id.
    return Promise.resolve(req.user?._id?.toString() ?? req.ip ?? '');
  }

  protected generateKey(
    _context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    return `${name}-${suffix}`;
  }

  // The app registers other named throttlers (password reset, spec 0007);
  // image routes only ever count against the upload one.
  protected handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    if (requestProps.throttler.name !== UPLOAD_THROTTLER) {
      return Promise.resolve(true);
    }
    return super.handleRequest(requestProps);
  }
}
