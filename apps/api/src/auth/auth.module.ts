import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CredentialStore } from './credential-store';
import { PasswordService } from './password.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ secret: config.jwtAccessSecret }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, CredentialStore, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, PasswordService],
})
export class AuthModule {}
