import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

// Transactional email (spec 0007), reused by billing emails later.
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
