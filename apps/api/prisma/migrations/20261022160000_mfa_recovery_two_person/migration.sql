-- Stage 2B review (A-1): two-person administrative MFA recovery (docs/security/mfa.md §8).
-- Part 1: Prisma-generated, purely additive DDL (reviewed).

-- CreateEnum
CREATE TYPE "MfaRecoveryStatus" AS ENUM ('PENDING', 'APPROVED', 'EXECUTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "mfa_recovery_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "target_user_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "MfaRecoveryStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "executed_at" TIMESTAMPTZ(3),

    CONSTRAINT "mfa_recovery_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mfa_recovery_requests_status_expires_at_idx" ON "mfa_recovery_requests"("status", "expires_at");

-- CreateIndex
CREATE INDEX "mfa_recovery_requests_target_user_id_idx" ON "mfa_recovery_requests"("target_user_id");

-- AddForeignKey
ALTER TABLE "mfa_recovery_requests" ADD CONSTRAINT "mfa_recovery_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_requests" ADD CONSTRAINT "mfa_recovery_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_requests" ADD CONSTRAINT "mfa_recovery_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Part 2 (hand-written): the rules are enforced by the database, not only by the API.

-- Separation of duties: nobody requests their own recovery; the approver/rejecter is
-- neither the requester nor the target.
ALTER TABLE mfa_recovery_requests ADD CONSTRAINT mfa_recovery_not_self_target CHECK (requested_by <> target_user_id);
ALTER TABLE mfa_recovery_requests ADD CONSTRAINT mfa_recovery_second_person CHECK (
  decided_by IS NULL OR (decided_by <> requested_by AND decided_by <> target_user_id));
ALTER TABLE mfa_recovery_requests ADD CONSTRAINT mfa_recovery_decided_by_required CHECK (
  status NOT IN ('APPROVED', 'EXECUTED', 'REJECTED') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL));
ALTER TABLE mfa_recovery_requests ADD CONSTRAINT mfa_recovery_executed_at CHECK ((status = 'EXECUTED') = (executed_at IS NOT NULL));
ALTER TABLE mfa_recovery_requests ADD CONSTRAINT mfa_recovery_expiry_window CHECK (
  expires_at > created_at AND expires_at <= created_at + interval '72 hours');
ALTER TABLE mfa_recovery_requests ADD CONSTRAINT mfa_recovery_reason_present CHECK (length(btrim(reason)) >= 10);

-- At most one open request per target.
CREATE UNIQUE INDEX mfa_recovery_one_open_per_target ON mfa_recovery_requests (target_user_id) WHERE status IN ('PENDING', 'APPROVED');

-- Immutable identity of a request; forward-only status transitions; a decision is final.
CREATE FUNCTION app_mfa_recovery_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.target_user_id IS DISTINCT FROM OLD.target_user_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'mfa_recovery_requests: target, requester, reason and expiry are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.decided_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN
    RAISE EXCEPTION 'mfa_recovery_requests: a decision cannot be reassigned' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
       (OLD.status = NEW.status)
    OR (OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'))
    OR (OLD.status = 'APPROVED' AND NEW.status = 'EXECUTED')
  ) THEN
    RAISE EXCEPTION 'mfa_recovery_requests: invalid status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER mfa_recovery_requests_guard BEFORE UPDATE ON mfa_recovery_requests
  FOR EACH ROW EXECUTE FUNCTION app_mfa_recovery_guard();
REVOKE EXECUTE ON FUNCTION app_mfa_recovery_guard() FROM PUBLIC;

-- Platform scope only, FORCEd (unlike the seeded catalogs, migrations never touch these rows;
-- the API is the only writer).
ALTER TABLE mfa_recovery_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY mfa_recovery_platform_select ON mfa_recovery_requests FOR SELECT TO ventidoc_app USING (app_platform_scope());
CREATE POLICY mfa_recovery_platform_insert ON mfa_recovery_requests FOR INSERT TO ventidoc_app WITH CHECK (app_platform_scope());
CREATE POLICY mfa_recovery_platform_update ON mfa_recovery_requests FOR UPDATE TO ventidoc_app
  USING (app_platform_scope()) WITH CHECK (app_platform_scope());
-- No DELETE privilege: requests are the audit trail of every recovery.
GRANT SELECT, INSERT, UPDATE ON mfa_recovery_requests TO ventidoc_app;
