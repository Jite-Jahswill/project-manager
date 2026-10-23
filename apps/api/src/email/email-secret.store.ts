import { Inject, Injectable } from '@nestjs/common';
import { AuthDb } from '../auth/auth-db';
import { APP_CONFIG, AppConfig } from '../config/env';
import { openWith, sealWith } from '../common/keyring';

/**
 * Email provider credentials (Resend API keys, SMTP passwords): AES-256-GCM under
 * EMAIL_SECRET_KEYS, bound to the provider ID, stored in email_provider_secrets which
 * only the ventidoc_auth role can access. Fixed, parameterized statements only.
 */
@Injectable()
export class EmailSecretStore {
  constructor(
    private readonly db: AuthDb,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private aad(providerId: string) {
    return `ventidoc-email-provider:${providerId}`;
  }

  async put(providerId: string, secret: string): Promise<void> {
    const ct = sealWith(this.config.emailKeyRing, this.aad(providerId), secret);
    await this.db.pool.query(
      `INSERT INTO email_provider_secrets (provider_id, ciphertext) VALUES ($1, $2)
       ON CONFLICT (provider_id) DO UPDATE SET ciphertext = $2, updated_at = now()`,
      [providerId, ct],
    );
  }

  async get(providerId: string): Promise<string | null> {
    const r = await this.db.pool.query<{ ciphertext: string }>('SELECT ciphertext FROM email_provider_secrets WHERE provider_id = $1', [providerId]);
    const row = r.rows[0];
    return row ? openWith(this.config.emailKeyRing, this.aad(providerId), row.ciphertext, 'email secret') : null;
  }

  async remove(providerId: string): Promise<void> {
    await this.db.pool.query('DELETE FROM email_provider_secrets WHERE provider_id = $1', [providerId]);
  }

  async keyUsage(): Promise<Record<string, number>> {
    const r = await this.db.pool.query<{ key_id: string; n: number }>(
      "SELECT split_part(ciphertext, ':', 2) AS key_id, count(*)::int AS n FROM email_provider_secrets GROUP BY 1",
    );
    return Object.fromEntries(r.rows.map((x) => [x.key_id, x.n]));
  }
}
