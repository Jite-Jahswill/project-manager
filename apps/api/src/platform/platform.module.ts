import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { MfaRecoveryService } from '../mfa/mfa-recovery.service';

@Module({ imports: [AuthModule], controllers: [PlatformController], providers: [MfaRecoveryService] })
export class PlatformModule {}
