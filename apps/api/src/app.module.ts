import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config/env';
import { AbuseModule } from './abuse/abuse.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthzModule } from './authz/authz.module';
import { PERMISSIONS } from './authz/permission-registry';
import { DatabaseModule } from './database/database.module';
import { PrismaService } from './database/prisma.service';
import { HealthController } from './health.controller';
import { InventoryModule } from './inventory/inventory.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { EmailModule } from './email/email.module';
import { AuthDbModule } from './auth/auth-db.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PlatformModule } from './platform/platform.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { SupportModule } from './support/support.module';

const configProvider = { provide: APP_CONFIG, useFactory: () => loadConfig() };

@Module({
  providers: [configProvider],
  exports: [configProvider],
})
class ConfigModule {}

@Module({
  imports: [
    { module: ConfigModule, global: true },
    // Registered before AuthModule: the global coarse rate limit runs before session lookups.
    AbuseModule,
    DatabaseModule,
    AuditModule,
    AuthDbModule,
    EmailModule,
    SubscriptionsModule,
    AuthModule,
    AuthzModule,
    OrganizationsModule,
    InventoryModule,
    PurchasingModule,
    PlatformModule,
    SupportModule,
  ],
  controllers: [HealthController],
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
