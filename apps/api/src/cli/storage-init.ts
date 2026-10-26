/**
 * Development and tests only: creates the S3 bucket if it does not exist and checks that clamd
 * answers. Usage: pnpm api storage:init. Production buckets are created and locked down by the
 * infrastructure (private, encrypted; docs/security/attachments.md §8), never by the application.
 */
import 'dotenv/config';
import { loadConfig } from '../config/env';
import { ClamAvScanner } from '../storage/malware-scanner';
import { S3ObjectStore } from '../storage/s3-object-store';

async function main() {
  const config = loadConfig();
  if (config.nodeEnv === 'production') throw new Error('storage:init is for development and tests only');
  if (config.storage.s3) {
    const store = new S3ObjectStore(config.storage.s3);
    console.log(`bucket ${config.storage.s3.bucket}: ${await store.ensureBucket()}`);
    store.destroy();
  }
  if (config.storage.clamav) {
    const verdict = await new ClamAvScanner(config.storage.clamav).scan(Buffer.from('ventidoc storage:init probe'));
    console.log(`clamd: ${verdict.clean ? 'reachable' : 'unexpected verdict'} (${verdict.engine})`);
  }
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
