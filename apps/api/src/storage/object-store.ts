/**
 * Private object storage for attachment bytes (docs/security/attachments.md). Bytes never go
 * into PostgreSQL; the database keeps metadata, the server-generated key and the SHA-256.
 * Nothing here ever produces a public or permanent URL: downloads are streamed by the API
 * after an authorization check, and only for objects scanned CLEAN.
 */

/** support/<conversation uuid>/<attachment uuid> or finance/<expense uuid>/<attachment uuid>. */
export const OBJECT_KEY = /^(support|finance)\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
/** The largest object any attachment may be (the upload limit). */
export const MAX_OBJECT_BYTES = 10 * 1024 * 1024;

export type Backend = 'LOCAL' | 'S3';

/** The store could not be reached or refused the operation (retryable). Never carries keys or credentials. */
export class StorageUnavailable extends Error {
  constructor(readonly backend: Backend, readonly operation: 'put' | 'get' | 'delete', readonly reason: string) {
    super(`${backend} storage ${operation} failed: ${reason}`);
    this.name = 'StorageUnavailable';
  }
}

/** The object does not exist in the store. */
export class ObjectMissing extends Error {
  constructor(readonly backend: Backend) {
    super(`object missing from ${backend} storage`);
    this.name = 'ObjectMissing';
  }
}

export abstract class ObjectStore {
  abstract readonly backend: Backend;
  /** Writes a new object; never overwrites. `sha256` is hex; stores that support it verify it on write. */
  abstract put(key: string, data: Buffer, sha256: string): Promise<void>;
  /** Reads an object (at most MAX_OBJECT_BYTES). Throws ObjectMissing or StorageUnavailable. */
  abstract get(key: string): Promise<Buffer>;
  /** Removes an object; removing a missing object succeeds. */
  abstract delete(key: string): Promise<void>;
}

export function assertKey(key: string): void {
  if (!OBJECT_KEY.test(key)) throw new Error('invalid storage key');
}
