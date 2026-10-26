import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AttachmentStorage, createAttachmentStorage } from './attachment-storage';
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
    {
      provide: AttachmentStorage,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): AttachmentStorage => createAttachmentStorage(config),
    },
  ],
  exports: [SupportRealtimeService],
})
export class SupportModule {}
