import { Global, Inject, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ActionTokenService } from '../auth/action-tokens.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import { missingKeyIds } from '../common/keyring';
import { EmailAdminController } from './email-admin.controller';
import { EmailAdminService } from './email-admin.service';
import { EmailSecretStore } from './email-secret.store';
import { EmailService } from './email.service';
import { EmailWorker } from './email-worker.service';
import { TenantDb } from '../database/tenant-db.service';

@Global()
@Module({
  controllers: [EmailAdminController],
  providers: [ActionTokenService, EmailSecretStore, EmailService, EmailWorker, EmailAdminService],
  exports: [EmailService, EmailWorker, ActionTokenService, EmailSecretStore],
})
export class EmailModule implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly secrets: EmailSecretStore,
    private readonly db: TenantDb,
  ) {}

  /** Refuse to start with an EMAIL_SECRET_KEYS ring missing a key still protecting data. */
  async onApplicationBootstrap(): Promise<void> {
    const usage = { ...(await this.secrets.keyUsage()) };
    const outbox = await this.db.asEmailWorker((tx) => tx.$queryRaw<{ key_id: string; n: number }[]>`
      SELECT split_part(sensitive_ciphertext, ':', 2) AS key_id, count(*)::int AS n FROM email_outbox WHERE sensitive_ciphertext IS NOT NULL GROUP BY 1`);
    for (const r of outbox) usage[r.key_id] = (usage[r.key_id] ?? 0) + r.n;
    const missing = missingKeyIds(usage, [...this.config.emailKeyRing.keys.keys()]);
    if (missing.length) throw new Error(`EMAIL_SECRET_KEYS is missing key(s) still protecting email credentials or queued messages: ${missing.join(', ')}`);
  }
}
