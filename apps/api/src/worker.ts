/**
 * Standalone background worker: `pnpm api worker` (build: node dist/worker.js).
 * Runs the same EmailWorker and AttachmentWorker as the inline modes, without an HTTP server. Any number of
 * worker processes can run against the same database (SKIP LOCKED + leases).
 * SIGTERM/SIGINT: finishes the job in flight, claims nothing new, then exits.
 */
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { EmailWorker } from './email/email-worker.service';
import { AttachmentWorker } from './storage/attachment-worker.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
  const worker = app.get(EmailWorker);
  worker.start();
  new Logger('Worker').log(JSON.stringify({ event: 'email.worker_started', worker: worker.workerId }));
  app.get(AttachmentWorker).start();
  new Logger('Worker').log(JSON.stringify({ event: 'storage.worker_started' }));
}

void main();
