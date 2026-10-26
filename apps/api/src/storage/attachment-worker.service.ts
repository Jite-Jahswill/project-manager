import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { AttachmentObjects } from './attachment-objects.service';

/**
 * Background attachment work: scans retried after a scanner outage (and legacy objects never
 * scanned), interrupted uploads cleaned up, infected bytes purged. Runs inline in the API
 * process (ATTACHMENT_WORKER_MODE=inline) or in `pnpm api worker` (external). Safe with any
 * number of instances: rows are claimed FOR UPDATE SKIP LOCKED with a lease.
 */
@Injectable()
export class AttachmentWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('AttachmentWorker');
  private running = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly objects: AttachmentObjects,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.storage.workerMode === 'inline') this.start();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        let busy = false;
        try {
          const r = await this.objects.runOnce();
          busy = r.scanned > 0 || r.swept > 0;
        } catch (e) {
          this.logger.warn(JSON.stringify({ event: 'storage.worker_error', error: (e as Error).name }));
        }
        if (!this.running) break;
        if (!busy) await new Promise<void>((r) => { this.wake = r; setTimeout(r, this.config.storage.workerPollMs); });
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    this.loop = null;
  }
}
