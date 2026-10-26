/**
 * Guards hand-written security objects that Prisma cannot model and would
 * otherwise silently drop in auto-generated migrations.
 *
 * 1. Fails if any migration newer than the one that created an object drops it
 *    without a later migration recreating it.
 * 2. Fails if `prisma migrate diff` (database -> schema) contains anything other
 *    than the known, intentional differences listed in ALLOWED_DIFF.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROTECTED_INDEXES = [
  'membership_roles_unique_assignment', 'membership_overrides_unique', 'mfa_recovery_one_open_per_target', 'email_templates_one_active_per_key',
  'organization_invitations_one_open_per_email', 'cashier_sessions_one_open', 'expenses_one_live_correction',
];
const ALLOWED_DIFF = PROTECTED_INDEXES.map((name) => `DROP INDEX "${name}";`);

const dir = join(__dirname, '..', 'prisma', 'migrations');
const migrations = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const failures: string[] = [];
for (const name of PROTECTED_INDEXES) {
  let present = false;
  for (const m of migrations) {
    const sql = readFileSync(join(dir, m, 'migration.sql'), 'utf8');
    if (new RegExp(`CREATE UNIQUE INDEX\\s+"?${name}"?`).test(sql)) present = true;
    if (new RegExp(`DROP INDEX\\s+"?${name}"?`).test(sql)) present = false;
  }
  if (!present) failures.push(`Protected index ${name} is dropped by a migration and never recreated.`);
}

if (process.argv.includes('--with-db')) {
  const out = execFileSync(
    'npx',
    ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const statements = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--') && !l.startsWith('Loaded Prisma config'));
  for (const stmt of statements) {
    if (!ALLOWED_DIFF.includes(stmt)) failures.push(`Unexpected schema drift: ${stmt}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  console.error('\nIf Prisma generated DROP INDEX for a protected index, delete those lines from the new migration.');
  process.exit(1);
}
console.log('Migration guard passed.');
