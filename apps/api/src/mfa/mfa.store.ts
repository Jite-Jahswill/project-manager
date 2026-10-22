import { Injectable } from '@nestjs/common';
import { AuthDb } from '../auth/auth-db';

export interface StoredFactor {
  secretCiphertext: string;
  lastUsedStep: number;
  confirmedAt: Date;
}

export interface StoredEnrollment {
  secretCiphertext: string;
  emailCodeHash: string | null;
  expiresAt: Date;
  attempts: number;
}

/**
 * MFA secret material, through the ventidoc_auth role only (see AuthDb). Every
 * statement is fixed and parameterized; the state changes that must be atomic
 * (replay protection, single-use recovery codes, enrollment activation) are single
 * conditional statements or one transaction.
 */
@Injectable()
export class MfaStore {
  constructor(private readonly db: AuthDb) {}

  async getFactor(userId: string): Promise<StoredFactor | null> {
    const r = await this.db.pool.query<{ secret_ciphertext: string; last_used_step: string; confirmed_at: Date }>(
      'SELECT secret_ciphertext, last_used_step, confirmed_at FROM user_mfa_factors WHERE user_id = $1',
      [userId],
    );
    const row = r.rows[0];
    return row ? { secretCiphertext: row.secret_ciphertext, lastUsedStep: Number(row.last_used_step), confirmedAt: row.confirmed_at } : null;
  }

  async hasFactor(userId: string): Promise<boolean> {
    const r = await this.db.pool.query('SELECT 1 FROM user_mfa_factors WHERE user_id = $1', [userId]);
    return r.rowCount === 1;
  }

  /** Atomic replay protection: succeeds only for a step later than every step accepted before. */
  async acceptTotpStep(userId: string, step: number): Promise<boolean> {
    const r = await this.db.pool.query(
      'UPDATE user_mfa_factors SET last_used_step = $2, updated_at = now() WHERE user_id = $1 AND last_used_step < $2',
      [userId, step],
    );
    return r.rowCount === 1;
  }

  /** Lazy key rotation; conditional so it can never overwrite a concurrent change. */
  async reencryptFactor(userId: string, oldCiphertext: string, newCiphertext: string): Promise<void> {
    await this.db.pool.query(
      'UPDATE user_mfa_factors SET secret_ciphertext = $3, updated_at = now() WHERE user_id = $1 AND secret_ciphertext = $2',
      [userId, oldCiphertext, newCiphertext],
    );
  }

  /** Atomic single use: of any number of concurrent attempts with the same code, exactly one succeeds. */
  async consumeRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
    const r = await this.db.pool.query(
      'UPDATE user_mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL',
      [userId, codeHash],
    );
    return r.rowCount === 1;
  }

  async remainingRecoveryCodes(userId: string): Promise<number> {
    const r = await this.db.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM user_mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL',
      [userId],
    );
    return r.rows[0].n;
  }

  /** Invalidates every previous code and stores the new hashes, atomically. */
  async replaceRecoveryCodes(userId: string, codeHashes: string[]): Promise<void> {
    await this.db.transaction(async (c) => {
      await c.query('DELETE FROM user_mfa_recovery_codes WHERE user_id = $1', [userId]);
      await c.query('INSERT INTO user_mfa_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])', [userId, codeHashes]);
    });
  }

  async putEnrollment(userId: string, secretCiphertext: string, emailCodeHash: string | null, expiresAt: Date): Promise<void> {
    await this.db.pool.query(
      `INSERT INTO user_mfa_enrollments (user_id, secret_ciphertext, email_code_hash, expires_at, attempts)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext = $2, email_code_hash = $3, expires_at = $4, attempts = 0, created_at = now()`,
      [userId, secretCiphertext, emailCodeHash, expiresAt],
    );
  }

  async getEnrollment(userId: string): Promise<StoredEnrollment | null> {
    const r = await this.db.pool.query<{ secret_ciphertext: string; email_code_hash: string | null; expires_at: Date; attempts: number }>(
      'SELECT secret_ciphertext, email_code_hash, expires_at, attempts FROM user_mfa_enrollments WHERE user_id = $1',
      [userId],
    );
    const row = r.rows[0];
    return row ? { secretCiphertext: row.secret_ciphertext, emailCodeHash: row.email_code_hash, expiresAt: row.expires_at, attempts: row.attempts } : null;
  }

  /** Counts a failed confirmation; deletes the enrollment once `max` is reached. */
  async failEnrollment(userId: string, max: number): Promise<void> {
    await this.db.pool.query('UPDATE user_mfa_enrollments SET attempts = attempts + 1 WHERE user_id = $1', [userId]);
    await this.db.pool.query('DELETE FROM user_mfa_enrollments WHERE user_id = $1 AND attempts >= $2', [userId, max]);
  }

  async deleteEnrollment(userId: string): Promise<boolean> {
    const r = await this.db.pool.query('DELETE FROM user_mfa_enrollments WHERE user_id = $1', [userId]);
    return r.rowCount === 1;
  }

  /**
   * Turns a proven enrollment into the active factor and installs fresh recovery
   * codes, in one transaction. Fails (returns false) if the enrollment was
   * cancelled, replaced or already used concurrently.
   */
  async activate(userId: string, enrollmentCiphertext: string, sealedSecret: string, acceptedStep: number, codeHashes: string[]): Promise<boolean> {
    return this.db.transaction(async (c) => {
      const claimed = await c.query('DELETE FROM user_mfa_enrollments WHERE user_id = $1 AND secret_ciphertext = $2 AND expires_at > now()', [
        userId, enrollmentCiphertext,
      ]);
      if (claimed.rowCount !== 1) return false;
      await c.query(
        `INSERT INTO user_mfa_factors (user_id, secret_ciphertext, confirmed_at, last_used_step)
         VALUES ($1, $2, now(), $3)
         ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext = $2, confirmed_at = now(), last_used_step = $3, updated_at = now()`,
        [userId, sealedSecret, acceptedStep],
      );
      await c.query('DELETE FROM user_mfa_recovery_codes WHERE user_id = $1', [userId]);
      await c.query('INSERT INTO user_mfa_recovery_codes (user_id, code_hash) SELECT $1, unnest($2::text[])', [userId, codeHashes]);
      return true;
    });
  }

  /** Removes the factor, recovery codes and any pending enrollment. Returns whether a factor existed. */
  async removeAll(userId: string): Promise<boolean> {
    return this.db.transaction(async (c) => {
      const f = await c.query('DELETE FROM user_mfa_factors WHERE user_id = $1', [userId]);
      await c.query('DELETE FROM user_mfa_recovery_codes WHERE user_id = $1', [userId]);
      await c.query('DELETE FROM user_mfa_enrollments WHERE user_id = $1', [userId]);
      return f.rowCount === 1;
    });
  }

  /** Key-rotation tooling: one page of factors still sealed under a non-active key. */
  async factorsNotUnderKey(activeKeyId: string, limit: number): Promise<{ userId: string; secretCiphertext: string }[]> {
    const r = await this.db.pool.query<{ user_id: string; secret_ciphertext: string }>(
      "SELECT user_id, secret_ciphertext FROM user_mfa_factors WHERE split_part(secret_ciphertext, ':', 2) <> $1 ORDER BY user_id LIMIT $2",
      [activeKeyId, limit],
    );
    return r.rows.map((x) => ({ userId: x.user_id, secretCiphertext: x.secret_ciphertext }));
  }

  async keyUsage(): Promise<Record<string, number>> {
    const r = await this.db.pool.query<{ key_id: string; n: number }>(
      "SELECT split_part(secret_ciphertext, ':', 2) AS key_id, count(*)::int AS n FROM user_mfa_factors GROUP BY 1",
    );
    return Object.fromEntries(r.rows.map((x) => [x.key_id, x.n]));
  }
}
