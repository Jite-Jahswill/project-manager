import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * argon2id with OWASP-recommended minimum parameters (19 MiB, t=2, p=1).
 * Raise memoryCost as server capacity allows; needsRehash() upgrades hashes on login.
 */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    // Verified against when the account does not exist, so response time does not reveal it.
    this.dummyHash = await argon2.hash('ventidoc-timing-equalizer', OPTIONS);
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string | null, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash ?? this.dummyHash, password);
    } catch {
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, OPTIONS);
  }
}
