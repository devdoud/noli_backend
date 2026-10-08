import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { UploadThrottlerGuard } from './upload-throttler.guard';

// The throttler store and options come from ThrottlerModule, registered
// once (global) in AppModule with every named throttler (throttler.config.ts).
@Module({
  providers: [MediaService, UploadThrottlerGuard],
  exports: [MediaService, UploadThrottlerGuard],
})
export class MediaModule {}
