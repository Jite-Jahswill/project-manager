import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/**
 * Private object storage for support attachments. Bytes never go into PostgreSQL; the
 * database keeps metadata and the server-generated key. Downloads always go through an
 * authorized API request (no public or permanent URLs).
 *
 * Only a local-disk driver exists, for development and tests. Production needs an
 * S3-compatible driver with private buckets and short-lived authorized downloads; until
 * then production mode is refused (config productionBlockers, docs/security/support.md §6).
 */
export abstract class AttachmentStorage {
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract remove(key: string): Promise<void>;
}

/** Same shape the database CHECK enforces: support/<conversation uuid>/<attachment uuid>. */
const KEY = /^support\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

export class LocalDiskAttachmentStorage extends AttachmentStorage {
  private readonly root: string;

  constructor(root: string) {
    super();
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    if (!KEY.test(key)) throw new Error('invalid storage key');
    const path = resolve(this.root, key);
    // Defense in depth on top of the key format: never leave the root.
    if (!path.startsWith(this.root + sep)) throw new Error('storage key escapes the storage root');
    return path;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // 'wx': never overwrite an existing object.
    await writeFile(path, data, { flag: 'wx', mode: 0o600 });
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
