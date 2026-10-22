import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * The only code that can read or write password hashes.
 *
 * It uses its own connection pool as the ventidoc_auth role, whose sole privilege
 * is SELECT/INSERT/UPDATE on user_credentials. The main application role
 * (ventidoc_app), used for every tenant and business query, has no access to that
 * table. A SQL-injection or query bug anywhere else therefore cannot read hashes.
 *
 * The surface is deliberately tiny: four fixed, parameterized statements.
 */
@Injectable()
export class CredentialStore implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.authDatabaseUrl, max: 5 });
  }

  async getHash(userId: string): Promise<string | null> {
    const res = await this.pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM user_credentials WHERE user_id = $1',
      [userId],
    );
    return res.rows[0]?.password_hash ?? null;
  }

  async create(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [userId, passwordHash]);
  }

  /** Replaces the hash; returns false if the user has no credential row. */
  async update(userId: string, passwordHash: string): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE user_credentials SET password_hash = $2, updated_at = now() WHERE user_id = $1',
      [userId, passwordHash],
    );
    return res.rowCount === 1;
  }

  /** Rehash on login only if nobody changed the password in the meantime. */
  async upgrade(userId: string, oldHash: string, newHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE user_credentials SET password_hash = $3, updated_at = now() WHERE user_id = $1 AND password_hash = $2',
      [userId, oldHash, newHash],
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
