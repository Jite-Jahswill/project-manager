import { Global, Module } from '@nestjs/common';
import { AuthDb } from './auth-db';

/** One shared pool for the ventidoc_auth role (credentials, MFA, email provider secrets). */
@Global()
@Module({ providers: [AuthDb], exports: [AuthDb] })
export class AuthDbModule {}
