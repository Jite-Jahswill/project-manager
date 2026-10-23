/**
 * MFA key rotation: re-encrypts every TOTP secret still sealed under a non-active key.
 * Usage: pnpm api mfa:reencrypt [--dry-run]
 * Run after adding a new key to MFA_ENCRYPTION_KEYS and making it active; retire the
 * old key only when this reports 0 remaining. Prints counts only, never secrets.
 */
import 'dotenv/config';
import { loadConfig } from '../config/env';
import { AuthDb } from '../auth/auth-db';
import { MfaStore } from '../mfa/mfa.store';
import { open, seal } from '../mfa/mfa-crypto';
import { missingKeyIds } from '../mfa/mfa.service';

async function main() {
  const config = loadConfig();
  const db = new AuthDb(config);
  const store = new MfaStore(db);
  const dryRun = process.argv.includes('--dry-run');
  try {
    const usage = await store.keyUsage();
    console.log('before:', usage);
    // Never start re-encrypting with an incomplete ring: report and stop, touching nothing.
    const missing = missingKeyIds(usage, [...config.mfaKeyRing.keys.keys()]);
    if (missing.length) throw new Error(`MFA_ENCRYPTION_KEYS lacks key(s) still in use: ${missing.join(', ')}; nothing was changed`);
    let done = 0;
    while (!dryRun) {
      const page = await store.factorsNotUnderKey(config.mfaKeyRing.activeKeyId, 200);
      if (page.length === 0) break;
      for (const f of page) {
        const secret = open(config.mfaKeyRing, f.userId, f.secretCiphertext);
        await store.reencryptFactor(f.userId, f.secretCiphertext, seal(config.mfaKeyRing, f.userId, secret));
        done++;
      }
    }
    console.log(`re-encrypted: ${done}`);
    console.log('after:', await store.keyUsage());
  } finally {
    await db.onApplicationShutdown();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'failed');
  process.exit(1);
});
