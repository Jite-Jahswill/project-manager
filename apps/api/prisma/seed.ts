/**
 * Syncs code-owned catalogs into the database. Idempotent; run after every
 * migration (pnpm api db:seed). Connects as the migrator role because the app
 * role has read-only access to the permission catalogs.
 *
 * Creates no users and no credentials.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { describeKey, PERMISSIONS } from '../src/authz/permission-registry';
import { PLATFORM_PERMISSIONS, PLATFORM_ROLE_TEMPLATES, SUPER_ADMIN_ROLE_NAME } from '../src/authz/platform-permission-registry';
import { PLAN_SEEDS } from '../src/subscriptions/entitlements';

export async function seed(databaseUrl: string): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    for (const p of PERMISSIONS.values()) {
      const data = { ...describeKey(p.key), scope: p.scope, sensitivity: p.sensitivity, description: p.description };
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, ...data }, update: data });
    }
    const stale = await prisma.permission.findMany({ where: { key: { notIn: [...PERMISSIONS.keys()] } }, select: { key: true } });
    if (stale.length) console.warn(`Permissions in DB but not in the registry (remove with a migration): ${stale.map((s) => s.key).join(', ')}`);

    for (const p of PLATFORM_PERMISSIONS.values()) {
      const data = { description: p.description, privileged: p.privileged };
      await prisma.platformPermission.upsert({ where: { key: p.key }, create: { key: p.key, ...data }, update: data });
    }
    // Platform permissions are code-owned: drop any no longer in the registry (and their
    // grants), so a removed capability (e.g. single-administrator MFA reset) disappears.
    const platformKeys = [...PLATFORM_PERMISSIONS.keys()];
    await prisma.platformRolePermission.deleteMany({ where: { permissionKey: { notIn: platformKeys } } });
    await prisma.platformPermission.deleteMany({ where: { key: { notIn: platformKeys } } });

    for (const t of PLATFORM_ROLE_TEMPLATES) {
      const isSystem = t.name === SUPER_ADMIN_ROLE_NAME;
      const role = await prisma.platformRole.upsert({
        where: { name: t.name },
        create: { name: t.name, description: t.description, isSystem },
        update: { description: t.description, isSystem },
      });
      // The super-admin role always tracks the full registry; other roles are only seeded once.
      const existing = await prisma.platformRolePermission.count({ where: { roleId: role.id } });
      if (isSystem || existing === 0) {
        await prisma.platformRolePermission.createMany({
          data: t.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
          skipDuplicates: true,
        });
      }
    }

    for (const plan of PLAN_SEEDS) {
      const row = await prisma.plan.upsert({ where: { code: plan.code }, create: { code: plan.code, name: plan.name }, update: { name: plan.name } });
      for (const price of plan.prices) {
        await prisma.planPrice.upsert({
          where: { planId_currency_interval: { planId: row.id, currency: price.currency, interval: price.interval } },
          create: { planId: row.id, ...price },
          update: { amountMinor: price.amountMinor },
        });
      }
      for (const e of plan.entitlements) {
        await prisma.planEntitlement.upsert({
          where: { planId_key: { planId: row.id, key: e.key } },
          create: { planId: row.id, key: e.key, limitValue: e.limitValue, enabled: e.enabled ?? true },
          update: {},
        });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is required');
  seed(url)
    .then(() => console.log('Seed complete.'))
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}
