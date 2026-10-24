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
import { TEMPLATE_DEFINITIONS } from '../src/email/templates';

export interface SeedOptions {
  /** Development/test only: bootstrap a LOG or CAPTURE provider, active, with sending on. Ignored in production. */
  devEmailProvider?: 'LOG' | 'CAPTURE';
}

export async function seed(databaseUrl: string, opts: SeedOptions = {}): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    for (const p of PERMISSIONS.values()) {
      const data = { ...describeKey(p.key), scope: p.scope, sensitivity: p.sensitivity, description: p.description };
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, ...data }, update: data });
    }
    const stale = await prisma.permission.findMany({ where: { key: { notIn: [...PERMISSIONS.keys()] } }, select: { key: true } });
    if (stale.length) console.warn(`Permissions in DB but not in the registry (remove with a migration): ${stale.map((s) => s.key).join(', ')}`);

    const knownPlatformKeys = new Set((await prisma.platformPermission.findMany({ select: { key: true } })).map((p) => p.key));
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
      // The super-admin role always tracks the full registry. Other roles are seeded once
      // (administrators may edit them afterwards), except that a permission introduced by
      // this seed run is granted to the template roles that list it.
      const existing = await prisma.platformRolePermission.count({ where: { roleId: role.id } });
      const grant = isSystem || existing === 0 ? [...t.permissions] : t.permissions.filter((k) => !knownPlatformKeys.has(k));
      if (grant.length) {
        await prisma.platformRolePermission.createMany({
          data: grant.map((permissionKey) => ({ roleId: role.id, permissionKey })),
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

    await seedEmail(prisma, opts);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Email bootstrap. Templates (version 1 from code) and an UNVERIFIED suggested sender
 * identity; production sending stays OFF. Everything after this is managed through the
 * platform-admin API, not environment variables.
 */
async function seedEmail(prisma: PrismaClient, opts: SeedOptions): Promise<void> {
  for (const t of TEMPLATE_DEFINITIONS) {
    if ((await prisma.emailTemplate.count({ where: { key: t.key } })) === 0) {
      await prisma.emailTemplate.create({
        data: { key: t.key, version: 1, subject: t.defaults.subject, textBody: t.defaults.text, htmlBody: t.defaults.html, status: 'ACTIVE', activatedAt: new Date() },
      });
    }
  }
  const suggested = (process.env.EMAIL_SUGGESTED_SENDER ?? 'no-reply@mail.havehub.com.ng').trim().toLowerCase();
  let sender = await prisma.emailSenderIdentity.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!sender) {
    sender = await prisma.emailSenderIdentity.create({ data: { email: suggested, displayName: 'Ventidoc', domain: suggested.split('@')[1] } });
  }
  const settings = await prisma.emailSettings.upsert({ where: { id: 1 }, create: { id: 1, defaultSenderId: sender.id }, update: {} });
  if (!settings.defaultSenderId) await prisma.emailSettings.update({ where: { id: 1 }, data: { defaultSenderId: sender.id } });

  const dev = opts.devEmailProvider ?? (process.env.EMAIL_BOOTSTRAP_DEV_PROVIDER as SeedOptions['devEmailProvider']);
  if (dev && process.env.NODE_ENV !== 'production') {
    if (!['LOG', 'CAPTURE'].includes(dev)) throw new Error('EMAIL_BOOTSTRAP_DEV_PROVIDER must be LOG or CAPTURE');
    const name = `development-${dev.toLowerCase()}`;
    const provider = await prisma.emailProvider.upsert({ where: { name }, create: { kind: dev, name, status: 'VERIFIED' }, update: {} });
    // Development/test throughput: tests sign up hundreds of users a minute. Production keeps the default cap.
    await prisma.emailSettings.update({ where: { id: 1 }, data: { activeProviderId: provider.id, sendingEnabled: true, maxSendsPerMinute: 10_000 } });
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
