import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Prisma client connected as the ventidoc_app role.
 *
 * Do not query tenant-owned tables through this client directly: without tenant
 * context RLS returns no rows. Use TenantDb, which opens a transaction and sets
 * the context. Direct use is reserved for identity tables (users, sessions, tokens).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
