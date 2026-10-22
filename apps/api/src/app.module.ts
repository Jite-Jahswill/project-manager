import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, AppConfig, loadConfig } from './config/env';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AUTH_RATE_LIMITED } from './auth/decorators';
import { AuthzModule } from './authz/authz.module';
import { PERMISSIONS } from './authz/permission-registry';
import { DatabaseModule } from './database/database.module';
import { PrismaService } from './database/prisma.service';
import { HealthController } from './health.controller';
import { InventoryModule } from './inventory/inventory.module';
import { MailModule } from './mail/mail.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PlatformModule } from './platform/platform.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';

const configProvider = { provide: APP_CONFIG, useFactory: () => loadConfig() };

@Module({
  providers: [configProvider],
  exports: [configProvider],
})
class ConfigModule {}

@Module({
  imports: [
    { module: ConfigModule, global: true },
    // In-memory counters: correct for a single instance only. Moving to Redis
    // storage is required before running more than one API instance.
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: 600 },
          {
            name: 'auth',
            ttl: 60_000,
            limit: config.authRateLimitPerMinute,
            skipIf: (ctx) => !Reflect.getMetadata(AUTH_RATE_LIMITED, ctx.getHandler()),
          },
        ],
      }),
    }),
    DatabaseModule,
    AuditModule,
    MailModule,
    SubscriptionsModule,
    AuthModule,
    AuthzModule,
    OrganizationsModule,
    InventoryModule,
    PlatformModule,
  ],
  controllers: [HealthController],
  // Throttler first, so rejected floods never reach the database.
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  /** Refuse to serve if the permission catalog in the database is behind the code. */
  async onApplicationBootstrap(): Promise<void> {
    const rows = await this.prisma.permission.findMany({ select: { key: true } });
    const inDb = new Set(rows.map((r) => r.key));
    const missing = [...PERMISSIONS.keys()].filter((k) => !inDb.has(k));
    if (missing.length) throw new Error(`Permission catalog out of date (missing ${missing.join(', ')}). Run: pnpm api db:seed`);
  }
}
