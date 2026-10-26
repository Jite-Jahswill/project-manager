import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client, S3ServiceException,
} from '@aws-sdk/client-s3';
import type { S3Config } from '../config/env';
import { assertKey, MAX_OBJECT_BYTES, ObjectMissing, ObjectStore, StorageUnavailable } from './object-store';

/**
 * S3-compatible private object store (AWS S3, Cloudflare R2, MinIO, SeaweedFS, ...).
 *
 * - The bucket must be private (no public ACLs or policy; Block Public Access on AWS). This code
 *   never makes objects public and never issues URLs.
 * - Credentials stay in server configuration (or the SDK's default chain: instance/task role).
 * - Writes carry a SHA-256 checksum the store verifies, and server-side encryption when configured.
 * - Objects are stored as application/octet-stream: the content type that reaches a browser comes
 *   from the database (sniffed and allow-listed at upload), never from object metadata.
 */
export class S3ObjectStore extends ObjectStore {
  readonly backend = 'S3' as const;
  private readonly client: S3Client;

  constructor(private readonly cfg: S3Config) {
    super();
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      forcePathStyle: cfg.forcePathStyle,
      ...(cfg.accessKeyId && cfg.secretAccessKey ? { credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } } : {}),
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
    });
  }

  async put(key: string, data: Buffer, sha256: string): Promise<void> {
    assertKey(key);
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.cfg.bucket, Key: key, Body: data, ContentLength: data.length, ContentType: 'application/octet-stream',
        ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
        ...(this.cfg.serverSideEncryption !== 'none' ? { ServerSideEncryption: this.cfg.serverSideEncryption } : {}),
        ...(this.cfg.serverSideEncryption === 'aws:kms' && this.cfg.kmsKeyId ? { SSEKMSKeyId: this.cfg.kmsKeyId } : {}),
      }));
    } catch (e) {
      throw new StorageUnavailable('S3', 'put', reason(e));
    }
  }

  async get(key: string): Promise<Buffer> {
    assertKey(key);
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      if ((out.ContentLength ?? 0) > MAX_OBJECT_BYTES) throw new StorageUnavailable('S3', 'get', 'object larger than allowed');
      const bytes = await out.Body?.transformToByteArray();
      if (!bytes) throw new StorageUnavailable('S3', 'get', 'empty response body');
      return Buffer.from(bytes);
    } catch (e) {
      if (e instanceof StorageUnavailable) throw e;
      if (e instanceof S3ServiceException && (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404)) throw new ObjectMissing('S3');
      throw new StorageUnavailable('S3', 'get', reason(e));
    }
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    } catch (e) {
      if (e instanceof S3ServiceException && e.$metadata?.httpStatusCode === 404) return;
      throw new StorageUnavailable('S3', 'delete', reason(e));
    }
  }

  /** Development and tests only: creates the bucket if it does not exist. */
  async ensureBucket(): Promise<'exists' | 'created'> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.cfg.bucket }));
      return 'exists';
    } catch (e) {
      if (!(e instanceof S3ServiceException && e.$metadata?.httpStatusCode === 404)) throw new StorageUnavailable('S3', 'get', reason(e));
    }
    await this.client.send(new CreateBucketCommand({ Bucket: this.cfg.bucket }));
    return 'created';
  }

  destroy(): void {
    this.client.destroy();
  }
}

/** An error name or HTTP status only: never request details, keys or credentials. */
function reason(e: unknown): string {
  if (e instanceof S3ServiceException) return `${e.name} (${e.$metadata?.httpStatusCode ?? 'no status'})`;
  if (e instanceof Error) return (e as NodeJS.ErrnoException).code ?? e.name;
  return 'error';
}
