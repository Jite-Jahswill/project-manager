-- CreateEnum
CREATE TYPE "AttachmentObjectState" AS ENUM ('UPLOADING', 'PENDING_SCAN', 'CLEAN', 'INFECTED', 'SCAN_FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "StorageBackend" AS ENUM ('LOCAL', 'S3');

-- CreateTable
CREATE TABLE "attachment_objects" (
    "id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "backend" "StorageBackend" NOT NULL,
    "state" "AttachmentObjectState" NOT NULL DEFAULT 'UPLOADING',
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "scan_attempts" INTEGER NOT NULL DEFAULT 0,
    "next_scan_at" TIMESTAMPTZ(3),
    "lease_until" TIMESTAMPTZ(3),
    "scanned_at" TIMESTAMPTZ(3),
    "scan_engine" TEXT,
    "scan_signature" TEXT,
    "object_deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attachment_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attachment_objects_storage_key_key" ON "attachment_objects"("storage_key");

-- CreateIndex
CREATE INDEX "attachment_objects_state_next_scan_at_idx" ON "attachment_objects"("state", "next_scan_at");


-- ===========================================================================
-- Hand-written: one lifecycle for every stored attachment (docs/security/attachments.md).
-- ===========================================================================

-- 1. Existing attachments (all on the local-disk driver) get an object row: LOCAL, PENDING_SCAN.
-- They stay where they are, readable by the local driver, until scanned (the worker) and moved
-- (`pnpm api attachments:migrate-storage`). Until scanned CLEAN they are not served: no file
-- that was never scanned is ever delivered as safe. The owner sees no tenant rows under FORCEd
-- RLS, so FORCE is lifted for the copy only (the same pattern as earlier data migrations).
ALTER TABLE support_attachments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_attachments NO FORCE ROW LEVEL SECURITY;
INSERT INTO attachment_objects (id, domain, storage_key, backend, state, content_type, size_bytes, sha256, next_scan_at, created_at, updated_at)
  SELECT id, 'support', storage_key, 'LOCAL', 'PENDING_SCAN', content_type, size_bytes, sha256, now(), created_at, now() FROM support_attachments;
INSERT INTO attachment_objects (id, domain, storage_key, backend, state, content_type, size_bytes, sha256, next_scan_at, created_at, updated_at)
  SELECT id, 'finance', storage_key, 'LOCAL', 'PENDING_SCAN', content_type, size_bytes, sha256, now(), created_at, now() FROM expense_attachments;
ALTER TABLE support_attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_attachments FORCE ROW LEVEL SECURITY;

-- AddForeignKey (after the backfill: every attachment now has its object)
ALTER TABLE "support_attachments" ADD CONSTRAINT "support_attachments_id_fkey" FOREIGN KEY ("id") REFERENCES "attachment_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_id_fkey" FOREIGN KEY ("id") REFERENCES "attachment_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Shape and state consistency.
ALTER TABLE attachment_objects
  ADD CONSTRAINT attachment_objects_domain CHECK (domain IN ('support', 'finance')),
  ADD CONSTRAINT attachment_objects_key CHECK (storage_key ~ ('^' || domain || '/[0-9a-f-]{36}/[0-9a-f-]{36}$')),
  ADD CONSTRAINT attachment_objects_size CHECK (size_bytes BETWEEN 1 AND 10485760),
  ADD CONSTRAINT attachment_objects_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT attachment_objects_type CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain')),
  ADD CONSTRAINT attachment_objects_attempts CHECK (scan_attempts >= 0),
  ADD CONSTRAINT attachment_objects_pending CHECK (state <> 'PENDING_SCAN' OR next_scan_at IS NOT NULL),
  ADD CONSTRAINT attachment_objects_verdict CHECK ((state IN ('CLEAN', 'INFECTED')) = (scanned_at IS NOT NULL AND scan_engine IS NOT NULL)
    OR (state IN ('PENDING_SCAN', 'SCAN_FAILED') AND scanned_at IS NULL)),
  ADD CONSTRAINT attachment_objects_signature CHECK ((state = 'INFECTED') = (scan_signature IS NOT NULL)),
  ADD CONSTRAINT attachment_objects_deleted CHECK (object_deleted_at IS NULL OR state IN ('INFECTED', 'ABANDONED'));

CREATE FUNCTION app_attachment_object_transition_ok(old_state text, new_state text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT CASE old_state
      WHEN 'UPLOADING'    THEN new_state IN ('UPLOADING', 'PENDING_SCAN', 'ABANDONED')
      WHEN 'PENDING_SCAN' THEN new_state IN ('PENDING_SCAN', 'CLEAN', 'INFECTED', 'SCAN_FAILED')
      WHEN 'SCAN_FAILED'  THEN new_state IN ('SCAN_FAILED', 'PENDING_SCAN')
      WHEN 'CLEAN'        THEN new_state = 'CLEAN'      -- only its backend may change (migration)
      WHEN 'INFECTED'     THEN new_state = 'INFECTED'   -- only object_deleted_at may be set
      WHEN 'ABANDONED'    THEN new_state = 'ABANDONED'  -- only object_deleted_at may be set
      ELSE false
    END
  $$;

CREATE FUNCTION app_attachment_object_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'UPLOADING' OR NEW.scan_attempts <> 0 OR NEW.scanned_at IS NOT NULL OR NEW.object_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'attachment_objects: new objects start as UPLOADING' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.domain, NEW.storage_key, NEW.content_type, NEW.size_bytes, NEW.sha256, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.domain, OLD.storage_key, OLD.content_type, OLD.size_bytes, OLD.sha256, OLD.created_at) THEN
    RAISE EXCEPTION 'attachment_objects: identity, key and content columns are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_attachment_object_transition_ok(OLD.state::text, NEW.state::text) THEN
    RAISE EXCEPTION 'attachment_objects: invalid state transition % -> %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  -- A verdict, once recorded, never changes; a deletion is recorded once.
  IF OLD.state IN ('CLEAN', 'INFECTED') AND (NEW.scanned_at, NEW.scan_engine, NEW.scan_signature) IS DISTINCT FROM (OLD.scanned_at, OLD.scan_engine, OLD.scan_signature) THEN
    RAISE EXCEPTION 'attachment_objects: a scan verdict is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.object_deleted_at IS NOT NULL AND NEW.object_deleted_at IS DISTINCT FROM OLD.object_deleted_at THEN
    RAISE EXCEPTION 'attachment_objects: a recorded deletion is immutable' USING ERRCODE = 'check_violation';
  END IF;
  -- Storage moves only forward (local disk -> S3), and only for bytes that still exist.
  IF NEW.backend IS DISTINCT FROM OLD.backend AND NOT (OLD.backend = 'LOCAL' AND NEW.backend = 'S3' AND OLD.state IN ('PENDING_SCAN', 'CLEAN', 'SCAN_FAILED')) THEN
    RAISE EXCEPTION 'attachment_objects: backend changes only from LOCAL to S3 for stored objects' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER attachment_objects_guard BEFORE INSERT OR UPDATE ON attachment_objects FOR EACH ROW EXECUTE FUNCTION app_attachment_object_guard();

-- 3. Access. Lifecycle changes (scan verdicts, storage moves, sweeps) happen only in the
-- attachment-worker scope; requests only create UPLOADING objects inside the transaction that
-- creates the attachment row, and read objects whose attachment they can already read.
CREATE FUNCTION app_attachment_worker_scope() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT COALESCE(current_setting('app.attachment_worker', true), '') = 'on' $$;
GRANT EXECUTE ON FUNCTION app_attachment_worker_scope() TO ventidoc_app;

ALTER TABLE attachment_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachment_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY attachment_objects_read ON attachment_objects FOR SELECT TO ventidoc_app USING (
  app_attachment_worker_scope()
  OR EXISTS (SELECT 1 FROM support_attachments a WHERE a.id = attachment_objects.id)
  OR EXISTS (SELECT 1 FROM expense_attachments e WHERE e.id = attachment_objects.id));
CREATE POLICY attachment_objects_create ON attachment_objects FOR INSERT TO ventidoc_app
  WITH CHECK (state = 'UPLOADING' AND app_current_user_id() IS NOT NULL);
CREATE POLICY attachment_objects_lifecycle ON attachment_objects FOR UPDATE TO ventidoc_app
  USING (app_attachment_worker_scope()) WITH CHECK (app_attachment_worker_scope());

GRANT SELECT, INSERT ON attachment_objects TO ventidoc_app;
-- Column-level: identity, key, content and hash columns are not updatable at all.
GRANT UPDATE (state, backend, scan_attempts, next_scan_at, lease_until, scanned_at, scan_engine, scan_signature, object_deleted_at, updated_at)
  ON attachment_objects TO ventidoc_app;
