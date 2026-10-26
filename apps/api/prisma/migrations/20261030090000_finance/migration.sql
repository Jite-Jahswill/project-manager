-- CreateEnum
CREATE TYPE "ExpenseCategoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('PAID_IN', 'PAID_OUT', 'CASH_DROP', 'BANK_DEPOSIT', 'BANK_WITHDRAWAL', 'REVERSAL');

-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ExpenseCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID,
    "category_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "occurred_on" DATE NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "cancelled_by_user_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "voided_by_user_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "corrects_expense_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "actor_user_id" UUID NOT NULL,
    "reason" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_attachments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "session_id" UUID,
    "number" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "reverses_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_organization_id_normalized_name_key" ON "expense_categories"("organization_id", "normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_id_organization_id_key" ON "expense_categories"("id", "organization_id");

-- CreateIndex
CREATE INDEX "expenses_organization_id_status_occurred_on_idx" ON "expenses"("organization_id", "status", "occurred_on");

-- CreateIndex
CREATE INDEX "expenses_organization_id_branch_id_occurred_on_idx" ON "expenses"("organization_id", "branch_id", "occurred_on");

-- CreateIndex
CREATE INDEX "expenses_organization_id_created_at_idx" ON "expenses"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_organization_id_number_key" ON "expenses"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_organization_id_idempotency_key_key" ON "expenses"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_id_organization_id_key" ON "expenses"("id", "organization_id");

-- CreateIndex
CREATE INDEX "expense_events_expense_id_created_at_idx" ON "expense_events"("expense_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "expense_attachments_storage_key_key" ON "expense_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "expense_attachments_expense_id_idx" ON "expense_attachments"("expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_reverses_id_key" ON "cash_movements"("reverses_id");

-- CreateIndex
CREATE INDEX "cash_movements_organization_id_branch_id_created_at_idx" ON "cash_movements"("organization_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "cash_movements_session_id_idx" ON "cash_movements"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_organization_id_number_key" ON "cash_movements"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_organization_id_idempotency_key_key" ON "cash_movements"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_id_organization_id_key" ON "cash_movements"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_organization_id_fkey" FOREIGN KEY ("category_id", "organization_id") REFERENCES "expense_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_corrects_expense_id_organization_id_fkey" FOREIGN KEY ("corrects_expense_id", "organization_id") REFERENCES "expenses"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_events" ADD CONSTRAINT "expense_events_expense_id_organization_id_fkey" FOREIGN KEY ("expense_id", "organization_id") REFERENCES "expenses"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_attachments" ADD CONSTRAINT "expense_attachments_expense_id_organization_id_fkey" FOREIGN KEY ("expense_id", "organization_id") REFERENCES "expenses"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "cashier_sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_reverses_id_organization_id_fkey" FOREIGN KEY ("reverses_id", "organization_id") REFERENCES "cash_movements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ===========================================================================
-- Hand-written: finance invariants (docs/architecture/13-finance.md). New tables only: no
-- existing row is touched, so the migration takes no long locks on existing data.
-- ===========================================================================

-- 1. Categories.
ALTER TABLE expense_categories
  ADD CONSTRAINT expense_categories_name CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  ADD CONSTRAINT expense_categories_normalized CHECK (normalized_name = lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))),
  ADD CONSTRAINT expense_categories_description CHECK (description IS NULL OR length(description) <= 500),
  ADD CONSTRAINT expense_categories_version CHECK (version >= 1);

-- 2. Expenses: amounts, identity, and a status that always matches its decision fields.
ALTER TABLE expenses
  ADD CONSTRAINT expenses_number CHECK (number ~ '^E-[0-9]{6,}$'),
  ADD CONSTRAINT expenses_amount CHECK (amount_minor BETWEEN 1 AND 1000000000000000),
  ADD CONSTRAINT expenses_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT expenses_description CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  ADD CONSTRAINT expenses_reference CHECK (reference IS NULL OR (length(reference) <= 100 AND reference !~ '[0-9]{13,19}')),
  ADD CONSTRAINT expenses_occurred_on CHECK (occurred_on >= DATE '2000-01-01'),
  ADD CONSTRAINT expenses_idempotency_key CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  ADD CONSTRAINT expenses_version CHECK (version >= 1),
  ADD CONSTRAINT expenses_submitted CHECK ((submitted_by_user_id IS NULL) = (submitted_at IS NULL)
    AND (status NOT IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'VOIDED') OR submitted_by_user_id IS NOT NULL)),
  ADD CONSTRAINT expenses_decided CHECK ((status IN ('APPROVED', 'REJECTED', 'VOIDED')) = (decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)),
  ADD CONSTRAINT expenses_rejected CHECK ((status = 'REJECTED') = (rejection_reason IS NOT NULL)
    AND (rejection_reason IS NULL OR length(btrim(rejection_reason)) BETWEEN 3 AND 500)),
  ADD CONSTRAINT expenses_cancelled CHECK ((status = 'CANCELLED') = (cancelled_by_user_id IS NOT NULL AND cancelled_at IS NOT NULL)
    AND (cancel_reason IS NULL OR length(cancel_reason) <= 500)),
  ADD CONSTRAINT expenses_voided CHECK ((status = 'VOIDED') = (voided_by_user_id IS NOT NULL AND voided_at IS NOT NULL AND void_reason IS NOT NULL)
    AND (void_reason IS NULL OR length(btrim(void_reason)) BETWEEN 3 AND 500)),
  -- Separation of duties, also for the Owner: nobody approves, rejects or voids their own expense.
  ADD CONSTRAINT expenses_no_self_decision CHECK (decided_by_user_id IS NULL OR decided_by_user_id <> created_by_user_id),
  ADD CONSTRAINT expenses_no_self_void CHECK (voided_by_user_id IS NULL OR voided_by_user_id <> created_by_user_id),
  ADD CONSTRAINT expenses_corrects_other CHECK (corrects_expense_id IS NULL OR corrects_expense_id <> id);
-- At most one live correction per voided expense (a rejected or cancelled one may be replaced).
CREATE UNIQUE INDEX expenses_one_live_correction ON expenses (organization_id, corrects_expense_id)
  WHERE corrects_expense_id IS NOT NULL AND status NOT IN ('REJECTED', 'CANCELLED', 'VOIDED');

CREATE FUNCTION app_expense_transition_ok(old_status text, new_status text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT old_status = new_status OR CASE old_status
      WHEN 'DRAFT'     THEN new_status IN ('SUBMITTED', 'CANCELLED')
      WHEN 'SUBMITTED' THEN new_status IN ('APPROVED', 'REJECTED', 'CANCELLED')
      WHEN 'APPROVED'  THEN new_status = 'VOIDED'
      ELSE false -- REJECTED, CANCELLED and VOIDED are terminal
    END
  $$;

CREATE FUNCTION app_expense_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.corrects_expense_id IS DISTINCT FROM OLD.corrects_expense_id THEN
    RAISE EXCEPTION 'expenses: identity columns are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_expense_transition_ok(OLD.status::text, NEW.status::text) THEN
    RAISE EXCEPTION 'expenses: invalid status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- Financial content is editable only in DRAFT: what was submitted is what is decided and reported.
  IF OLD.status <> 'DRAFT' AND (NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.description IS DISTINCT FROM OLD.description OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.occurred_on IS DISTINCT FROM OLD.occurred_on) THEN
    RAISE EXCEPTION 'expenses: only a draft can be edited' USING ERRCODE = 'check_violation';
  END IF;
  -- A non-draft row changes only by a transition, and recorded decisions never change afterwards.
  IF OLD.status <> 'DRAFT' AND NEW.status = OLD.status
     AND to_jsonb(NEW) - 'updated_at' - 'version' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' - 'version' THEN
    RAISE EXCEPTION 'expenses: a % expense is immutable', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.submitted_by_user_id IS NOT NULL AND (NEW.submitted_by_user_id IS DISTINCT FROM OLD.submitted_by_user_id OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at))
     OR (OLD.decided_by_user_id IS NOT NULL AND (NEW.decided_by_user_id IS DISTINCT FROM OLD.decided_by_user_id OR NEW.decided_at IS DISTINCT FROM OLD.decided_at)) THEN
    RAISE EXCEPTION 'expenses: recorded submissions and decisions are immutable' USING ERRCODE = 'check_violation';
  END IF;
  -- Server-managed version: any change is exactly one new version.
  IF to_jsonb(NEW) - 'updated_at' - 'version' IS DISTINCT FROM to_jsonb(OLD) - 'updated_at' - 'version' OR NEW.version <> OLD.version THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER expenses_guard BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION app_expense_guard();

-- New expenses start as drafts; a correction must name a voided expense of the same organization.
CREATE FUNCTION app_expense_insert_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.status <> 'DRAFT' OR NEW.version <> 1 THEN
    RAISE EXCEPTION 'expenses: new expenses start as version 1 drafts' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.corrects_expense_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM expenses e WHERE e.id = NEW.corrects_expense_id AND e.organization_id = NEW.organization_id AND e.status = 'VOIDED') THEN
    RAISE EXCEPTION 'expenses: only a voided expense can be corrected' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER expenses_insert_guard BEFORE INSERT ON expenses FOR EACH ROW EXECUTE FUNCTION app_expense_insert_guard();

-- 3. Attachments: server-generated private keys, allow-listed types, only while the expense is open.
ALTER TABLE expense_attachments
  ADD CONSTRAINT expense_attachments_key CHECK (storage_key ~ '^finance/[0-9a-f-]{36}/[0-9a-f-]{36}$'),
  ADD CONSTRAINT expense_attachments_size CHECK (size_bytes BETWEEN 1 AND 10485760),
  ADD CONSTRAINT expense_attachments_sha256 CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT expense_attachments_file_name CHECK (length(file_name) BETWEEN 1 AND 200),
  ADD CONSTRAINT expense_attachments_type CHECK (content_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain'));

CREATE FUNCTION app_expense_attachment_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = NEW.expense_id AND e.organization_id = NEW.organization_id AND e.status IN ('DRAFT', 'SUBMITTED')) THEN
    RAISE EXCEPTION 'expense_attachments: the expense is no longer open' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER expense_attachments_guard BEFORE INSERT ON expense_attachments FOR EACH ROW EXECUTE FUNCTION app_expense_attachment_guard();

-- 4. Cash movements: direction follows the type; reversals mirror their original exactly;
-- session-linked movements only go into an OPEN session of the same branch and currency.
ALTER TABLE cash_movements
  ADD CONSTRAINT cash_movements_number CHECK (number ~ '^C-[0-9]{6,}$'),
  ADD CONSTRAINT cash_movements_amount CHECK (amount_minor BETWEEN 1 AND 1000000000000000),
  ADD CONSTRAINT cash_movements_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT cash_movements_reason CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  ADD CONSTRAINT cash_movements_reference CHECK (reference IS NULL OR (length(reference) <= 100 AND reference !~ '[0-9]{13,19}')),
  ADD CONSTRAINT cash_movements_idempotency_key CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  ADD CONSTRAINT cash_movements_direction CHECK (
    (type = 'PAID_IN' AND direction = 'IN') OR (type = 'PAID_OUT' AND direction = 'OUT') OR (type = 'CASH_DROP' AND direction = 'OUT')
    OR (type = 'BANK_DEPOSIT' AND direction = 'OUT') OR (type = 'BANK_WITHDRAWAL' AND direction = 'IN') OR type = 'REVERSAL'),
  ADD CONSTRAINT cash_movements_reversal CHECK ((type = 'REVERSAL') = (reverses_id IS NOT NULL) AND (reverses_id IS NULL OR reverses_id <> id)),
  ADD CONSTRAINT cash_movements_drop_session CHECK (type <> 'CASH_DROP' OR session_id IS NOT NULL);

CREATE FUNCTION app_cash_movement_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE o cash_movements%ROWTYPE;
BEGIN
  IF NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM cashier_sessions s WHERE s.id = NEW.session_id AND s.organization_id = NEW.organization_id
      AND s.branch_id = NEW.branch_id AND s.currency = NEW.currency AND s.status = 'OPEN') THEN
    RAISE EXCEPTION 'cash_movements: the cashier session is not open at this branch in this currency' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.type = 'REVERSAL' THEN
    SELECT * INTO o FROM cash_movements WHERE id = NEW.reverses_id AND organization_id = NEW.organization_id;
    IF NOT FOUND OR o.type = 'REVERSAL' OR o.branch_id <> NEW.branch_id OR o.session_id IS DISTINCT FROM NEW.session_id
       OR o.currency <> NEW.currency OR o.amount_minor <> NEW.amount_minor OR o.direction = NEW.direction THEN
      RAISE EXCEPTION 'cash_movements: a reversal must mirror its original movement' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER cash_movements_guard BEFORE INSERT ON cash_movements FOR EACH ROW EXECUTE FUNCTION app_cash_movement_guard();

-- 5. Append-only: history, attachments and cash postings are never changed or deleted.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_events', 'expense_attachments', 'cash_movements'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_reject_mutation()', t || '_append_only', t);
  END LOOP;
END
$$;

-- 6. Privileges: nothing is ever deleted by the runtime role.
GRANT SELECT, INSERT, UPDATE ON expense_categories, expenses TO ventidoc_app;
GRANT SELECT, INSERT ON expense_events, expense_attachments, cash_movements TO ventidoc_app;

-- 7. Tenant isolation: the same membership-bound policy as every other business table, FORCEd.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_categories', 'expenses', 'expense_events', 'expense_attachments', 'cash_movements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO ventidoc_app
      USING (organization_id = app_current_org_id() AND (SELECT app_is_active_member()))
      WITH CHECK (organization_id = app_current_org_id() AND (SELECT app_is_active_member()))', t);
  END LOOP;
END
$$;
