import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthDb } from './auth-db';
import { CredentialStore } from './credential-store';
import { PasswordService } from './password.service';
import { MfaController } from '../mfa/mfa.controller';
import { MfaPolicyService } from '../mfa/mfa-policy.service';
import { MfaService } from '../mfa/mfa.service';
import { MfaStore } from '../mfa/mfa.store';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ secret: config.jwtAccessSecret }),
    }),
  ],
  controllers: [AuthController, MfaController],
  providers: [AuthDb, AuthService, PasswordService, CredentialStore, MfaStore, MfaPolicyService, MfaService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthDb, AuthService, PasswordService, CredentialStore, MfaService, MfaPolicyService, MfaStore],
})
export class AuthModule {}
