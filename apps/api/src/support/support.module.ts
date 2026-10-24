import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AttachmentStorage, LocalDiskAttachmentStorage } from './attachment-storage';
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
      useFactory: (config: AppConfig): AttachmentStorage => {
        // The local driver is for development and tests (production mode is refused until
        // an object-storage driver exists; config productionBlockers).
        if (config.nodeEnv === 'production') throw new Error('The local attachment storage driver is not allowed in production');
        return new LocalDiskAttachmentStorage(config.supportStorageDir);
      },
    },
  ],
  exports: [SupportRealtimeService],
})
export class SupportModule {}
