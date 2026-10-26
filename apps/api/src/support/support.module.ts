import { Module } from '@nestjs/common';
import { SupportAdminController } from './support-admin.controller';
import { SupportAttachmentsService } from './support-attachments.service';
import { SupportRealtimeService } from './support-realtime.service';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  controllers: [SupportController, SupportAdminController],
  providers: [
    SupportService,
    SupportAttachmentsService,
    SupportRealtimeService,
  ],
  exports: [SupportRealtimeService],
})
export class SupportModule {}
