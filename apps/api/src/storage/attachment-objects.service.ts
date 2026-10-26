import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { ApiError, Errors } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { MalwareScanner, ScannerUnavailable, type ScanVerdict } from './malware-scanner';
import { type Backend, ObjectMissing, ObjectStore, StorageUnavailable } from './object-store';

export type ObjectState = 'UPLOADING' | 'PENDING_SCAN' | 'CLEAN' | 'INFECTED' | 'SCAN_FAILED' | 'ABANDONED';
export interface StoredObject { id: string; state: ObjectState; backend: Backend; storageKey: string; sha256: string; sizeBytes: number }

/** The stores in use: the write store for new uploads, plus every store an existing object may live in. */
export class ObjectStores {
  constructor(readonly write: ObjectStore, private readonly all: ReadonlyMap<Backend, ObjectStore>) {}
  for(backend: Backend): ObjectStore {
    const s = this.all.get(backend);
    if (!s) throw new StorageUnavailable(backend, 'get', 'backend not configured');
    return s;
  }
  has(backend: Backend): boolean {
    return this.all.has(backend);
  }
}

const sha256Hex = (data: Buffer) => createHash('sha256').update(data).digest('hex');
/** Exponential retry for scans the scanner could not perform: 30 s, 1 min, 2 min, ... at most 1 h. */
export const scanBackoffMs = (attempt: number) => Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);

/**
 * The lifecycle of every stored attachment (docs/security/attachments.md §3):
 *
 *   UPLOADING ─stored→ PENDING_SCAN ─scan→ CLEAN | INFECTED (bytes deleted)
 *       │                  │ scanner down: retried with back-off ─max→ SCAN_FAILED
 *       └ interrupted (TTL) → ABANDONED (any bytes deleted)
 *
 * The object row is committed (UPLOADING) with its attachment row BEFORE any bytes are written,
 * so every byte in storage is accounted for in the database and an interrupted upload is found
 * and cleaned by the sweeper. Lifecycle updates run in the attachment-worker scope only.
 * Downloads are served only for CLEAN objects whose bytes still hash to the recorded SHA-256.
 */
@Injectable()
export class AttachmentObjects {
  private readonly logger = new Logger('AttachmentObjects');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: TenantDb,
    private readonly stores: ObjectStores,
    private readonly scanner: MalwareScanner,
    private readonly audit: AuditService,
  ) {}

  /** Inside the caller's transaction, before the attachment row: the UPLOADING object row. */
  async register(tx: Tx, o: { id: string; domain: 'support' | 'finance'; storageKey: string; contentType: string; data: Buffer; sha256: string }) {
    await tx.attachmentObject.createMany({
      data: [{ id: o.id, domain: o.domain, storageKey: o.storageKey, backend: this.stores.write.backend, contentType: o.contentType, sizeBytes: o.data.length, sha256: o.sha256 }],
    });
  }

  /**
   * After the caller committed: stores the bytes, then scans them. Returns the state the object
   * reached. A storage failure abandons the object and answers 503; a scanner failure leaves it
   * PENDING_SCAN for the worker to retry.
   */
  async storeAndScan(id: string, storageKey: string, data: Buffer, sha256: string): Promise<ObjectState> {
    try {
      await this.stores.write.put(storageKey, data, sha256);
    } catch (e) {
      this.logger.warn(JSON.stringify({ event: 'storage.put_failed', attachmentId: id, backend: this.stores.write.backend, reason: (e as StorageUnavailable).reason ?? 'error' }));
      // The bytes may or may not have landed: delete (idempotent), then abandon. Leftovers are swept.
      await this.stores.write.delete(storageKey).catch(() => undefined);
      await this.worker((tx) => tx.$executeRaw`
        UPDATE attachment_objects SET state = 'ABANDONED', object_deleted_at = now(), updated_at = now() WHERE id = ${id}::uuid AND state = 'UPLOADING'`).catch(() => undefined);
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'storage_unavailable', 'The file could not be stored; please try again');
    }
    await this.worker((tx) => tx.$executeRaw`
      UPDATE attachment_objects SET state = 'PENDING_SCAN', next_scan_at = now(), updated_at = now() WHERE id = ${id}::uuid AND state = 'UPLOADING'`);
    return this.scanAndRecord(id, data, 0);
  }

  /**
   * Bytes of a CLEAN object, verified against the recorded size and SHA-256. 409 while the
   * object is not CLEAN (scan pending or failed, infected, abandoned): such bytes are never served.
   */
  async readVerified(o: StoredObject): Promise<Buffer> {
    if (o.state !== 'CLEAN') throw unavailable(o.state);
    let data: Buffer;
    try {
      data = await this.stores.for(o.backend).get(o.storageKey);
    } catch (e) {
      if (e instanceof ObjectMissing) {
        this.logger.error(JSON.stringify({ event: 'storage.object_missing', attachmentId: o.id, backend: o.backend }));
        throw Errors.notFound('Attachment');
      }
      this.logger.warn(JSON.stringify({ event: 'storage.get_failed', attachmentId: o.id, backend: o.backend, reason: (e as StorageUnavailable).reason ?? 'error' }));
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'storage_unavailable', 'The file is temporarily unavailable; please try again');
    }
    if (data.length !== o.sizeBytes || sha256Hex(data) !== o.sha256) {
      this.logger.error(JSON.stringify({ event: 'storage.integrity_failure', attachmentId: o.id, backend: o.backend }));
      throw new ApiError(HttpStatus.CONFLICT, 'attachment_integrity_error', 'The stored file does not match what was uploaded and will not be served');
    }
    return data;
  }

  // ---------------------------------------------------------------- worker operations

  /** One worker pass: sweep interrupted uploads and leftover infected bytes, then scan due objects. */
  async runOnce(batch = 10): Promise<{ swept: number; scanned: number }> {
    const swept = await this.sweep(batch);
    const due = await this.worker((tx) => tx.$queryRaw<{ id: string; backend: Backend; storage_key: string; sha256: string; size_bytes: number; scan_attempts: number }[]>`
      UPDATE attachment_objects SET lease_until = now() + interval '5 minutes', scan_attempts = scan_attempts + 1, updated_at = now()
      WHERE id IN (
        SELECT id FROM attachment_objects
        WHERE state = 'PENDING_SCAN' AND next_scan_at <= now() AND (lease_until IS NULL OR lease_until < now())
        ORDER BY next_scan_at LIMIT ${batch} FOR UPDATE SKIP LOCKED)
      RETURNING id, backend, storage_key, sha256, size_bytes, scan_attempts`);
    for (const o of due) {
      let data: Buffer;
      try {
        data = await this.stores.for(o.backend).get(o.storage_key);
        if (data.length !== o.size_bytes || sha256Hex(data) !== o.sha256) throw new Error('integrity');
      } catch (e) {
        // Missing or altered bytes cannot become CLEAN: count the attempt and retry, then SCAN_FAILED.
        this.logger.warn(JSON.stringify({ event: 'storage.scan_read_failed', attachmentId: o.id, backend: o.backend, reason: e instanceof ObjectMissing ? 'missing' : (e as Error).message === 'integrity' ? 'integrity' : 'unavailable' }));
        await this.retryLater(o.id, o.scan_attempts);
        continue;
      }
      await this.scanAndRecord(o.id, data, o.scan_attempts);
    }
    return { swept, scanned: due.length };
  }

  /**
   * Interrupted uploads (UPLOADING past the TTL): delete any bytes, then ABANDONED. Infected
   * objects whose deletion failed earlier: delete again. A storage failure leaves the row for the
   * next pass, so bytes are never left untracked.
   */
  async sweep(batch = 50): Promise<number> {
    const cutoff = new Date(Date.now() - this.config.storage.uploadTtlMs);
    const rows = await this.worker((tx) => tx.$queryRaw<{ id: string; backend: Backend; storage_key: string; state: ObjectState }[]>`
      SELECT id, backend, storage_key, state::text AS state FROM attachment_objects
      WHERE (state = 'UPLOADING' AND created_at < ${cutoff}) OR (state = 'INFECTED' AND object_deleted_at IS NULL)
      ORDER BY created_at LIMIT ${batch} FOR UPDATE SKIP LOCKED`);
    let n = 0;
    for (const r of rows) {
      try {
        if (this.stores.has(r.backend)) await this.stores.for(r.backend).delete(r.storage_key);
      } catch {
        continue;
      }
      const done = await this.worker((tx) => tx.$executeRaw`
        UPDATE attachment_objects SET state = (CASE WHEN state = 'UPLOADING' THEN 'ABANDONED' ELSE state END)::"AttachmentObjectState",
          object_deleted_at = now(), updated_at = now()
        WHERE id = ${r.id}::uuid AND ((state = 'UPLOADING' AND created_at < ${cutoff}) OR (state = 'INFECTED' AND object_deleted_at IS NULL))`);
      if (done) {
        n++;
        this.logger.log(JSON.stringify({ event: r.state === 'UPLOADING' ? 'storage.upload_abandoned' : 'storage.infected_purged', attachmentId: r.id }));
      }
    }
    return n;
  }

  /**
   * Moves objects from the local-disk store to S3 (`pnpm api attachments:migrate-storage`):
   * read, verify the recorded SHA-256, write to S3, read back and verify, switch the backend,
   * then remove the local file (unless keepLocal). Idempotent; a failure leaves the object where
   * it was. INFECTED and ABANDONED objects have no bytes to move.
   */
  async migrateLocalToS3(opts: { dryRun: boolean; keepLocal: boolean; batch?: number }) {
    if (!this.stores.has('S3') || this.stores.write.backend !== 'S3') throw new Error('Configure ATTACHMENT_STORAGE_DRIVER=s3 (and S3_*) before migrating');
    const local = this.stores.for('LOCAL');
    const s3 = this.stores.for('S3');
    const report = { candidates: 0, moved: 0, failed: [] as { id: string; reason: string }[] };
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const rows = await this.worker((tx) => tx.$queryRaw<{ id: string; storage_key: string; sha256: string; size_bytes: number }[]>`
        SELECT id, storage_key, sha256, size_bytes FROM attachment_objects
        WHERE backend = 'LOCAL' AND state IN ('PENDING_SCAN', 'CLEAN', 'SCAN_FAILED') AND id > ${after}::uuid
        ORDER BY id LIMIT ${opts.batch ?? 100}`);
      if (!rows.length) break;
      after = rows[rows.length - 1].id;
      for (const r of rows) {
        report.candidates++;
        try {
          const data = await local.get(r.storage_key);
          if (data.length !== r.size_bytes || sha256Hex(data) !== r.sha256) throw new Error('local bytes do not match the recorded SHA-256');
          if (opts.dryRun) continue;
          await s3.put(r.storage_key, data, r.sha256);
          const back = await s3.get(r.storage_key);
          if (sha256Hex(back) !== r.sha256) throw new Error('S3 copy does not match the recorded SHA-256');
          const switched = await this.worker((tx) => tx.$executeRaw`
            UPDATE attachment_objects SET backend = 'S3', updated_at = now() WHERE id = ${r.id}::uuid AND backend = 'LOCAL'`);
          if (switched && !opts.keepLocal) await local.delete(r.storage_key);
          report.moved += switched;
        } catch (e) {
          report.failed.push({ id: r.id, reason: e instanceof ObjectMissing ? 'local file missing' : (e as Error).message });
        }
      }
    }
    return report;
  }

  // ---------------------------------------------------------------- internals

  private async scanAndRecord(id: string, data: Buffer, attempts: number): Promise<ObjectState> {
    let verdict: ScanVerdict;
    try {
      verdict = await this.scanner.scan(data);
    } catch (e) {
      if (!(e instanceof ScannerUnavailable)) throw e;
      this.logger.warn(JSON.stringify({ event: 'storage.scan_unavailable', attachmentId: id, scanner: this.scanner.name, reason: e.reason }));
      return this.retryLater(id, Math.max(attempts, 1));
    }
    if (verdict.clean) {
      await this.worker((tx) => tx.$executeRaw`
        UPDATE attachment_objects SET state = 'CLEAN', scanned_at = now(), scan_engine = ${verdict.engine}, lease_until = NULL, next_scan_at = NULL, updated_at = now()
        WHERE id = ${id}::uuid AND state = 'PENDING_SCAN'`);
      return 'CLEAN';
    }
    const [o] = await this.worker(async (tx) => {
      const rows = await tx.$queryRaw<{ backend: Backend; storage_key: string; domain: string }[]>`
        UPDATE attachment_objects SET state = 'INFECTED', scanned_at = now(), scan_engine = ${verdict.engine}, scan_signature = ${verdict.signature},
          lease_until = NULL, next_scan_at = NULL, updated_at = now()
        WHERE id = ${id}::uuid AND state = 'PENDING_SCAN' RETURNING backend, storage_key, domain`;
      if (rows.length) {
        await this.audit.record(tx, {
          action: 'storage.attachment.malware_detected', resourceType: 'attachment_object', resourceId: id, actorType: 'SYSTEM',
          metadata: { domain: rows[0].domain, signature: verdict.signature, engine: verdict.engine },
        });
      }
      return rows;
    });
    this.logger.warn(JSON.stringify({ event: 'storage.malware_detected', attachmentId: id, signature: verdict.signature }));
    if (o) {
      // Quarantine by deletion: the bytes go now; if that fails, the sweeper retries.
      try {
        await this.stores.for(o.backend).delete(o.storage_key);
        await this.worker((tx) => tx.$executeRaw`UPDATE attachment_objects SET object_deleted_at = now(), updated_at = now() WHERE id = ${id}::uuid AND object_deleted_at IS NULL`);
      } catch {
        this.logger.warn(JSON.stringify({ event: 'storage.infected_delete_failed', attachmentId: id }));
      }
    }
    return 'INFECTED';
  }

  private async retryLater(id: string, attempts: number): Promise<ObjectState> {
    const failed = attempts >= this.config.storage.scanMaxAttempts;
    const next = new Date(Date.now() + scanBackoffMs(attempts));
    await this.worker((tx) => tx.$executeRaw`
      UPDATE attachment_objects SET state = ${failed ? 'SCAN_FAILED' : 'PENDING_SCAN'}::"AttachmentObjectState",
        scan_attempts = GREATEST(scan_attempts, ${attempts}), next_scan_at = ${failed ? null : next}, lease_until = NULL, updated_at = now()
      WHERE id = ${id}::uuid AND state = 'PENDING_SCAN'`);
    if (failed) this.logger.error(JSON.stringify({ event: 'storage.scan_failed', attachmentId: id, attempts }));
    return failed ? 'SCAN_FAILED' : 'PENDING_SCAN';
  }

  private worker<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.asAttachmentWorker(fn);
  }
}

/** Why a non-CLEAN object is not served: clear to the client, without storage details. */
export function unavailable(state: ObjectState): ApiError {
  const why: Record<string, [string, string]> = {
    UPLOADING: ['attachment_not_ready', 'The file is still being uploaded'],
    PENDING_SCAN: ['attachment_scan_pending', 'The file is being checked for malware; try again shortly'],
    SCAN_FAILED: ['attachment_scan_failed', 'The file could not be checked for malware and will not be served'],
    INFECTED: ['attachment_blocked', 'The file was blocked by the malware scanner'],
    ABANDONED: ['attachment_not_ready', 'The upload did not complete'],
  };
  const [code, message] = why[state] ?? ['attachment_unavailable', 'The file is not available'];
  return new ApiError(HttpStatus.CONFLICT, code, message);
}
