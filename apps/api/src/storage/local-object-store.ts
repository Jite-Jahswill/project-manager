import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { assertKey, MAX_OBJECT_BYTES, ObjectMissing, ObjectStore, StorageUnavailable } from './object-store';

/**
 * Local-disk store: development and tests, and objects written before private object storage
 * existed (read until `pnpm api attachments:migrate-storage` moves them). Refused as the write
 * driver in production (config productionBlockers).
 */
export class LocalObjectStore extends ObjectStore {
  readonly backend = 'LOCAL' as const;
  private readonly root: string;

  constructor(root: string) {
    super();
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    assertKey(key);
    const path = resolve(this.root, key);
    // Defense in depth on top of the key format: never leave the root.
    if (!path.startsWith(this.root + sep)) throw new Error('storage key escapes the storage root');
    return path;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      // 'wx': never overwrite an existing object.
      await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    } catch (e) {
      throw new StorageUnavailable('LOCAL', 'put', (e as NodeJS.ErrnoException).code ?? 'error');
    }
  }

  async get(key: string): Promise<Buffer> {
    const path = this.pathFor(key);
    try {
      const data = await readFile(path);
      if (data.length > MAX_OBJECT_BYTES) throw new StorageUnavailable('LOCAL', 'get', 'object larger than allowed');
      return data;
    } catch (e) {
      if (e instanceof StorageUnavailable) throw e;
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ObjectMissing('LOCAL');
      throw new StorageUnavailable('LOCAL', 'get', (e as NodeJS.ErrnoException).code ?? 'error');
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await rm(this.pathFor(key), { force: true });
    } catch (e) {
      throw new StorageUnavailable('LOCAL', 'delete', (e as NodeJS.ErrnoException).code ?? 'error');
    }
  }
}
