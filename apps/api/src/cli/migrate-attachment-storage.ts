/**
 * Moves attachment bytes from the local-disk store to S3 (docs/security/attachments.md §6).
 * Usage: pnpm api attachments:migrate-storage [--dry-run] [--keep-local]
 * Requires ATTACHMENT_STORAGE_DRIVER=s3 with S3_* configured, and ATTACHMENT_LOCAL_DIR pointing at
 * the existing files. Per object: read, verify the recorded SHA-256, write to S3, read back and
 * verify, switch the record to S3, then delete the local file (unless --keep-local). Idempotent:
 * run it again to retry failures. Prints counts and attachment IDs only.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AttachmentObjects } from '../storage/attachment-objects.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const report = await app.get(AttachmentObjects).migrateLocalToS3({ dryRun: process.argv.includes('--dry-run'), keepLocal: process.argv.includes('--keep-local') });
    console.log(JSON.stringify({ dryRun: process.argv.includes('--dry-run'), ...report }, null, 2));
    if (report.failed.length) process.exitCode = 2;
  } finally {
    await app.close();
  }
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
