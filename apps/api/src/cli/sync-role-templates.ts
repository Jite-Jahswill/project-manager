/**
 * Role template sync for existing organizations (docs/architecture/10-organizations.md §10.6).
 * Usage: pnpm api roles:sync-templates [--dry-run]
 * `pnpm api db:seed` runs the same sync; this command exists to preview it (--dry-run) or to
 * re-run it on its own. Additive and idempotent: it grants only what newer template versions
 * added, never what an organization explicitly removed, and never removes anything.
 * Prints role and organization IDs and permission keys only.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { formatSyncReport, syncRoleTemplates } from '../authz/role-template-sync';

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is required (the sync runs as the schema owner)');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const report = await syncRoleTemplates(prisma, { dryRun: process.argv.includes('--dry-run') });
    for (const line of formatSyncReport(report)) console.log(line);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
