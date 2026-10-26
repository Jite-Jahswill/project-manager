import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import './env';
import Redis from 'ioredis';

/** Applies all migrations and seeds catalogs into the test database once per run. */
export default async function globalSetup(): Promise<void> {
  // Redis-backed behavior must never be reported as passing without a real Redis.
  const redis = new Redis(process.env.REDIS_URL as string, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try {
    await redis.connect();
    await redis.ping();
  } catch (e) {
    throw new Error(`BLOCKED: the Redis test service (TEST_REDIS_URL) is unavailable: ${(e as Error).message}. Start it with \`pnpm infra:up\`.`);
  } finally {
    redis.disconnect();
  }
  // Attachment storage and malware scanning must be real too (docker compose: objectstore, clamav).
  const { loadConfig } = await import('../../src/config/env');
  const { S3ObjectStore } = await import('../../src/storage/s3-object-store');
  const { ClamAvScanner } = await import('../../src/storage/malware-scanner');
  const config = loadConfig();
  const store = new S3ObjectStore(config.storage.s3!);
  try {
    await store.ensureBucket();
  } catch (e) {
    throw new Error(`BLOCKED: the S3-compatible test store (S3_ENDPOINT) is unavailable: ${(e as Error).message}. Start it with \`pnpm infra:up\`.`);
  } finally {
    store.destroy();
  }
  try {
    await new ClamAvScanner(config.storage.clamav!).scan(Buffer.from('ventidoc test setup probe'));
  } catch (e) {
    throw new Error(`BLOCKED: the ClamAV test scanner (CLAMAV_HOST:CLAMAV_PORT) is unavailable: ${(e as Error).message}. Start it with \`pnpm infra:up\`.`);
  }
  const cwd = resolve(__dirname, '../..');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd, env: process.env, stdio: ['ignore', 'ignore', 'inherit'] });
  const { seed } = await import('../../prisma/seed');
  await seed(process.env.MIGRATION_DATABASE_URL as string, { devEmailProvider: 'CAPTURE' });
}
