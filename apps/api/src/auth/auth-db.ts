import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Connection pool for the ventidoc_auth role: the only role with privileges on
 * credential material (user_credentials, user_mfa_*). Used exclusively by
 * CredentialStore and MfaStore, which issue fixed, parameterized statements.
 */
@Injectable()
export class AuthDb implements OnApplicationShutdown {
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.authDatabaseUrl, max: 5 });
  }

  async transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** Closed in the last shutdown phase, after background workers stopped (onModuleDestroy). */
  async onApplicationShutdown(): Promise<void> {
    if (!this.ended) {
      this.ended = true;
      await this.pool.end();
    }
  }

  private ended = false;
}
