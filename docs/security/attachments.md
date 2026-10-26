# Attachments: private object storage and malware scanning (Phase 7)

Code: `src/storage/` (shared), used by support (`src/support/support-attachments.service.ts`) and finance (`src/finance/expenses.service.ts`). Migration `20261101090000_attachment_objects`. Tests:
- `test/attachment-storage.e2e-spec.ts`: real S3-compatible storage and real ClamAV;
- `src/storage/storage.spec.ts` and `src/config/env.spec.ts`;
- the support and finance suites.

## 1. Guarantees

- **One implementation.** Support and expense attachments share the same storage, scanning, lifecycle and delivery code.
- **Private storage.** Bytes live in a private S3-compatible bucket; PostgreSQL holds metadata, the server-generated key and the SHA-256. No public, permanent or pre-signed URL is ever issued. Downloads are **authenticated streaming** through the API, authorized on every request by the domain's existing rules:
  - support: the uploader or conversation participant, or staff with `attachments.read` and visibility;
  - finance: the creator or `finance.expense.read` at the expense's branch, under tenant RLS.
- **Credentials stay server-side** (configuration or the SDK's default chain). Responses never contain storage keys, backends, endpoints, paths or credentials.
- **Content, not names, decides the type.** The 10 MB limit applies while the body is read, and the type is detected from the bytes against an allowlist (PNG, JPEG, GIF, WebP, PDF, UTF-8 text) and must match the declared type. File names are sanitized and used only in `Content-Disposition`. Objects are stored as `application/octet-stream`. The content type a browser sees comes from the database, with `nosniff`, a sandboxing CSP and `Cache-Control: private, no-store`.
- **Nothing unscanned is served.** Only objects a malware scanner has reported **CLEAN** are delivered. "Scanner unavailable" is never clean.
- **Integrity on every read.** Downloads and scans re-hash the stored bytes. A size or SHA-256 mismatch is refused (`409 attachment_integrity_error`) and logged.
- **No untracked bytes.** The object row commits before any byte is written (§3), so every stored object is accounted for, and interrupted uploads are found and cleaned.

## 2. Architecture

- **`ObjectStore`.** Drivers:
  - `S3ObjectStore` (AWS SDK v3, `@aws-sdk/client-s3` 3.1149.0, pinned): AWS S3, Cloudflare R2, MinIO, SeaweedFS and other S3-compatible stores;
  - `LocalObjectStore`: development and tests, and legacy files awaiting migration.

  `ObjectStores` routes reads to each object's recorded backend; new writes go to the configured driver.
- **`MalwareScanner`.** `ClamAvScanner` speaks clamd's INSTREAM protocol over TCP (length-prefixed 64 KiB chunks); `NoMalwareScanner` is used when `MALWARE_SCANNER=none`, so nothing is ever served.
- **`AttachmentObjects`.** The lifecycle: register, store and scan, verified reads, sweeps and migration.
- **`AttachmentWorker`.** Inline in the API (`ATTACHMENT_WORKER_MODE=inline`) or in `pnpm api worker` (`external`). Any number of instances can run safely: rows are claimed `FOR UPDATE SKIP LOCKED` with a 5-minute lease.

## 3. Lifecycle (`attachment_objects`, one row per attachment, same id)

```
UPLOADING ─bytes stored→ PENDING_SCAN ─scan→ CLEAN            (served)
    │                         │        └scan→ INFECTED         (bytes deleted; blocked)
    │                         └ scanner down: retried, 30 s doubling to 1 h ─max attempts→ SCAN_FAILED (never served)
    └ upload interrupted (older than ATTACHMENT_UPLOAD_TTL_MS) → ABANDONED (any bytes deleted)
```

**Upload.**
1. Authorize, then read the body with the size limit and validate the content.
2. In one transaction: the UPLOADING object row, the attachment row, an expense event if applicable, and the audit record.
3. Write the bytes to storage.
4. Mark the object PENDING_SCAN.
5. Scan inline and record the verdict. The response carries `scanStatus`.

**Failure handling.**
- **Storage write fails:** the partial object is deleted, the row becomes ABANDONED, and the request gets `503 storage_unavailable`. The client uploads again.
- **Scanner fails:** the upload succeeds as `PENDING_SCAN` and the worker retries.
- **Process dies after step 2:** the sweeper finds the UPLOADING row after the TTL, deletes any bytes and marks it ABANDONED. Deletion failures are retried on the next pass.

**Downloads.** Any state other than CLEAN gets a 409:

| State | Code |
|---|---|
| UPLOADING, ABANDONED | `attachment_not_ready` |
| PENDING_SCAN | `attachment_scan_pending` |
| SCAN_FAILED | `attachment_scan_failed` |
| INFECTED | `attachment_blocked` |

A missing object is 404 and logged; an unreachable store is `503 storage_unavailable`.

**Domain rules.**
- A support message can only carry attachments that are `PENDING_SCAN` or `CLEAN`.
- Abandoned and blocked uploads don't count towards the 10-file limit per expense.

**Database enforcement.**
- **Triggers:** legal transitions only, and immutable identity, key, content and hash columns. A verdict, once recorded, never changes, and a recorded deletion never changes. The backend moves only LOCAL → S3.
- **CHECKs:** domain, key format per domain, size, hash, type, and state and field consistency.
- **RLS:**
  - requests may create only UPLOADING rows;
  - an object is readable only together with an attachment the caller can already read;
  - lifecycle updates require the attachment-worker scope (`app.attachment_worker`, `TenantDb.asAttachmentWorker`).
- **Grants:** column-level UPDATE covers lifecycle columns only, and there is no DELETE.

## 4. Malware scanning

- **Engine:** ClamAV via clamd (`clamav/clamav-debian:1.4`, pinned by digest in `docker-compose.yml`).
- **Verdicts:**
  - `stream: OK` is CLEAN;
  - `stream: <signature> FOUND` is INFECTED. The signature name (sanitized) and engine/signature-database version are recorded, the bytes are deleted, and a platform audit event `storage.attachment.malware_detected` is written;
  - anything else is retried and is never clean: errors, size-limit replies, timeouts (`CLAMAV_TIMEOUT_MS`) and refused connections.
- **Stream limit:** clamd's `StreamMaxLength` must be at least 10 MB (the default is 25 MB).
- **Tested** with the EICAR test file against the real clamd, and with a fake clamd for protocol framing, timeouts and malformed replies.
- **Limits:**
  - signature-based scanning cannot detect novel malware;
  - files are scanned once, at upload. Rescanning CLEAN files when signatures update is not implemented;
  - image metadata (EXIF) is **not** stripped.

## 5. Failures and retries

| Failure | Behavior |
|---|---|
| Body too large / wrong type / empty | 413 / 415 / 400 before anything is stored |
| Storage unreachable on upload | 503 `storage_unavailable`; object ABANDONED, nothing served. SDK retries up to 3 times (5 s connect, 30 s request timeouts) |
| Storage unreachable on download | 503 `storage_unavailable` (retryable) |
| Scanner unreachable | upload 201 with `PENDING_SCAN`; worker retries with back-off; after `ATTACHMENT_SCAN_MAX_ATTEMPTS` (10) → SCAN_FAILED |
| Process killed mid-upload | sweeper: ABANDONED after `ATTACHMENT_UPLOAD_TTL_MS` (15 min), bytes deleted |
| Infected-file deletion fails | retried by the sweeper until the bytes are gone |
| Stored bytes altered or missing | not served (409 integrity / 404); not scanned CLEAN |

**Write-side checksums are provider-dependent.** Uploads send `ChecksumSHA256`. AWS S3 verifies it, but the SeaweedFS development store accepted a deliberately wrong checksum. The read-side SHA-256 verification above is therefore the guarantee relied on, not the provider's.

## 6. Existing local-disk attachments (migration)

Migration `20261101090000_attachment_objects` creates an object row for **every existing attachment**: backend LOCAL, state PENDING_SCAN, with the attachment's key, size and hash (verified on a seeded database).

- **Nothing breaks silently.** Existing records stay in place and readable by the local driver, so set `ATTACHMENT_LOCAL_DIR` to the old `SUPPORT_STORAGE_DIR`.
- **They are not served until scanned.** Downloads answer `409 attachment_scan_pending` until the worker scans them. A file whose bytes no longer match its recorded hash is never marked CLEAN.

**Moving them to S3:**
1. Configure S3.
2. Run `pnpm api attachments:migrate-storage --dry-run`, then without the flag (add `--keep-local` to keep the local copies). For each object, the command:
   - reads the local file and verifies the recorded SHA-256;
   - writes it to S3, reads it back and verifies it;
   - switches the record to S3;
   - deletes the local file.
3. Failures are reported by attachment ID and leave the object where it was. The command is idempotent; rerun it to retry. INFECTED and ABANDONED objects have no bytes to move.

**Order:** deploy, `db:migrate`, `db:seed`, start the worker, let the scans finish, then migrate storage.

## 7. Retention and deletion

- **Attachments are kept as long as their record.** Expense attachments are evidence for financial records and are never deleted by the application. Support attachments follow support's retention, which is undefined (docs/security/support.md §10).
- **Object rows are never deleted** (no DELETE grant). Bytes are deleted only for INFECTED objects (immediately) and ABANDONED uploads (by the sweeper). Their rows remain, with `object_deleted_at`, as the record of what happened.
- **Database and storage consistency:**
  - every stored byte has a committed row (§3);
  - a row may outlive its bytes only in ABANDONED and INFECTED states, where `object_deleted_at` records it;
  - a CLEAN row whose bytes are missing is reported (`storage.object_missing`) and answers 404.
- **Not done:** erasure workflows (GDPR/NDPA), retention periods and legal holds. These need legal and data-protection decisions.
- **Backups:** bucket versioning or backups must follow the database backup schedule. Restoring one without the other can leave rows without bytes or bytes without rows. The first is detected as above; the second is invisible to users, because nothing references those bytes.

## 8. Configuration and production

| Variable | Meaning |
|---|---|
| `ATTACHMENT_STORAGE_DRIVER` | `local` (development) or `s3` |
| `ATTACHMENT_LOCAL_DIR` | local driver and legacy files (replaces `SUPPORT_STORAGE_DIR`, which is now refused) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE` | the bucket (endpoint unset for AWS) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | both or neither (neither: instance/task role) |
| `S3_SSE`, `S3_SSE_KMS_KEY_ID` | `none`, `AES256` or `aws:kms` (with a key ID) |
| `MALWARE_SCANNER`, `CLAMAV_HOST`, `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` | `clamav` or `none` |
| `ATTACHMENT_WORKER_MODE`, `ATTACHMENT_WORKER_POLL_MS`, `ATTACHMENT_UPLOAD_TTL_MS`, `ATTACHMENT_SCAN_MAX_ATTEMPTS` | worker |

Development: `pnpm infra:up` starts SeaweedFS and ClamAV; `pnpm api storage:init` creates the bucket and checks clamd. Tests use their own bucket (`TEST_S3_BUCKET`, which must end with `-test`) and fail clearly if either service is down.

**Production stays refused.** `productionBlockers()` checks the actual configuration:
- the driver must be `s3`;
- the endpoint must be `https`;
- server-side encryption must be on;
- the scanner must be `clamav`;
- the worker must not be `off`.

It also keeps a standing blocker: **the bucket must be verified private in the target account** (Block Public Access, no public policy or ACLs), with backups or versioning aligned with the database, and ClamAV signature updates (freshclam) must be monitored. Code cannot verify these.

**Decisions not made here:**
- the storage provider and account;
- the bucket region and KMS key;
- the ClamAV deployment: it needs about 1 GB of RAM, and its daily signature updates need egress;
- retention periods.
