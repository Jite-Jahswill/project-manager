import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import './env';

/** Applies all migrations and seeds catalogs into the test database once per run. */
export default async function globalSetup(): Promise<void> {
  const cwd = resolve(__dirname, '../..');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd, env: process.env, stdio: ['ignore', 'ignore', 'inherit'] });
  const { seed } = await import('../../prisma/seed');
  await seed(process.env.MIGRATION_DATABASE_URL as string);
}
