-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CashierSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD_EXTERNAL', 'BANK_TRANSFER', 'MOBILE_MONEY', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "SaleReturnStatus" AS ENUM ('ACCEPTED', 'RESTOCKED');

-- CreateEnum
CREATE TYPE "ReturnDisposition" AS ENUM ('RESALEABLE', 'DAMAGED', 'UNSELLABLE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'SALE';
ALTER TYPE "StockMovementType" ADD VALUE 'SALE_RETURN';
ALTER TYPE "StockMovementType" ADD VALUE 'SALE_VOID';

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "home_branch_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashier_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "cashier_user_id" UUID NOT NULL,
    "status" "CashierSessionStatus" NOT NULL DEFAULT 'OPEN',
    "currency" CHAR(3) NOT NULL,
    "opening_float_minor" BIGINT NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_cash_minor" BIGINT,
    "declared_cash_minor" BIGINT,
    "variance_minor" BIGINT,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_user_id" UUID,
    "close_note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cashier_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "customer_id" UUID,
    "number" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "currency" CHAR(3) NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "related_return_id" UUID,
    "cashier_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "line_total_minor" BIGINT NOT NULL,
    "quantity_returned" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "movement_id" UUID NOT NULL,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "session_id" UUID,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount_minor" BIGINT NOT NULL,
    "refunded_minor" BIGINT NOT NULL DEFAULT 0,
    "reference" TEXT,
    "verification" TEXT NOT NULL DEFAULT 'MANUAL',
    "idempotency_key" TEXT NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "confirmed_by_user_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "return_id" UUID,
    "session_id" UUID,
    "method" "PaymentMethod" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "SaleReturnStatus" NOT NULL DEFAULT 'ACCEPTED',
    "reason" TEXT NOT NULL,
    "accepted_by_user_id" UUID NOT NULL,
    "restocked_by_user_id" UUID,
    "restocked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_return_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "sale_line_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "disposition" "ReturnDisposition" NOT NULL,

    CONSTRAINT "sale_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_organization_id_name_idx" ON "customers"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_email_key" ON "customers"("organization_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_phone_key" ON "customers"("organization_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_id_organization_id_key" ON "customers"("id", "organization_id");

-- CreateIndex
CREATE INDEX "cashier_sessions_organization_id_branch_id_status_idx" ON "cashier_sessions"("organization_id", "branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cashier_sessions_id_organization_id_key" ON "cashier_sessions"("id", "organization_id");

-- CreateIndex
CREATE INDEX "sales_organization_id_branch_id_created_at_idx" ON "sales"("organization_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_organization_id_customer_id_idx" ON "sales"("organization_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_organization_id_number_key" ON "sales"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_organization_id_idempotency_key_key" ON "sales"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "sales_id_organization_id_key" ON "sales"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_lines_sale_id_line_no_key" ON "sale_lines"("sale_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "sale_lines_sale_id_product_id_key" ON "sale_lines"("sale_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_lines_id_organization_id_key" ON "sale_lines"("id", "organization_id");

-- CreateIndex
CREATE INDEX "payments_sale_id_idx" ON "payments"("sale_id");

-- CreateIndex
CREATE INDEX "payments_session_id_idx" ON "payments"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organization_id_idempotency_key_key" ON "payments"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_organization_id_key" ON "payments"("id", "organization_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_organization_id_idempotency_key_key" ON "refunds"("organization_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "sale_returns_sale_id_idx" ON "sale_returns"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_organization_id_idempotency_key_key" ON "sale_returns"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_id_organization_id_key" ON "sale_returns"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_return_lines_return_id_sale_line_id_key" ON "sale_return_lines"("return_id", "sale_line_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_home_branch_id_organization_id_fkey" FOREIGN KEY ("home_branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_sessions" ADD CONSTRAINT "cashier_sessions_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "cashier_sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_organization_id_fkey" FOREIGN KEY ("customer_id", "organization_id") REFERENCES "customers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_organization_id_fkey" FOREIGN KEY ("sale_id", "organization_id") REFERENCES "sales"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_product_id_organization_id_fkey" FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_movement_id_organization_id_fkey" FOREIGN KEY ("movement_id", "organization_id") REFERENCES "stock_movements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_organization_id_fkey" FOREIGN KEY ("sale_id", "organization_id") REFERENCES "sales"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "cashier_sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_sale_id_organization_id_fkey" FOREIGN KEY ("sale_id", "organization_id") REFERENCES "sales"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_organization_id_fkey" FOREIGN KEY ("payment_id", "organization_id") REFERENCES "payments"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_return_id_organization_id_fkey" FOREIGN KEY ("return_id", "organization_id") REFERENCES "sale_returns"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_session_id_organization_id_fkey" FOREIGN KEY ("session_id", "organization_id") REFERENCES "cashier_sessions"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_organization_id_fkey" FOREIGN KEY ("sale_id", "organization_id") REFERENCES "sales"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_return_id_organization_id_fkey" FOREIGN KEY ("return_id", "organization_id") REFERENCES "sale_returns"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_line_id_organization_id_fkey" FOREIGN KEY ("sale_line_id", "organization_id") REFERENCES "sale_lines"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written: sales, POS sessions, payments, refunds and returns (docs/architecture/12-sales.md).
-- New StockMovementType values cannot be used as enum literals in this transaction: checks
-- compare type::text.
-- ===========================================================================

-- 1. Ledger: sales post SALE (out), restocked returns SALE_RETURN (in), voids SALE_VOID (in).
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_source_type;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_source_type CHECK (source_type IS NULL OR source_type IN
  ('TRANSFER', 'COUNT', 'GOODS_RECEIPT', 'SUPPLIER_RETURN', 'SALE', 'SALE_RETURN', 'SALE_VOID'));
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_sale_direction CHECK (
  (type::text <> 'SALE' OR quantity_delta < 0) AND (type::text NOT IN ('SALE_RETURN', 'SALE_VOID') OR quantity_delta > 0));

-- 2. Integrity constraints.
ALTER TABLE customers
  ADD CONSTRAINT customers_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  ADD CONSTRAINT customers_email CHECK (email IS NULL OR (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+$' AND length(email) <= 254)),
  ADD CONSTRAINT customers_phone CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{6,15}$'),
  ADD CONSTRAINT customers_notes CHECK (notes IS NULL OR length(notes) <= 1000),
  ADD CONSTRAINT customers_version CHECK (version >= 1);
ALTER TABLE cashier_sessions
  ADD CONSTRAINT cashier_sessions_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT cashier_sessions_float CHECK (opening_float_minor BETWEEN 0 AND 1000000000000000),
  ADD CONSTRAINT cashier_sessions_closed CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL
    AND expected_cash_minor IS NOT NULL AND declared_cash_minor IS NOT NULL AND variance_minor IS NOT NULL)),
  ADD CONSTRAINT cashier_sessions_variance CHECK (variance_minor IS NULL OR variance_minor = declared_cash_minor - expected_cash_minor),
  ADD CONSTRAINT cashier_sessions_declared CHECK (declared_cash_minor IS NULL OR declared_cash_minor >= 0);
-- One open session per cashier and branch (also under concurrent opens).
CREATE UNIQUE INDEX cashier_sessions_one_open ON cashier_sessions (organization_id, branch_id, cashier_user_id) WHERE status = 'OPEN';
ALTER TABLE sales
  ADD CONSTRAINT sales_number CHECK (number ~ '^R-[0-9]{6,}$'),
  ADD CONSTRAINT sales_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT sales_total CHECK (total_minor >= 0),
  ADD CONSTRAINT sales_version CHECK (version >= 1),
  ADD CONSTRAINT sales_voided CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL AND length(btrim(void_reason)) >= 3));
ALTER TABLE sale_lines
  ADD CONSTRAINT sale_lines_quantities CHECK (quantity > 0 AND quantity_returned >= 0 AND quantity_returned <= quantity),
  ADD CONSTRAINT sale_lines_price CHECK (unit_price_minor BETWEEN 0 AND 1000000000000000),
  ADD CONSTRAINT sale_lines_total CHECK (line_total_minor = round(quantity * unit_price_minor)),
  ADD CONSTRAINT sale_lines_line_no CHECK (line_no >= 1);
ALTER TABLE payments
  ADD CONSTRAINT payments_amount CHECK (amount_minor > 0 AND amount_minor <= 1000000000000000),
  ADD CONSTRAINT payments_refunded CHECK (refunded_minor >= 0 AND refunded_minor <= amount_minor AND (refunded_minor = 0 OR status = 'CONFIRMED')),
  ADD CONSTRAINT payments_confirmed CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL AND confirmed_by_user_id IS NOT NULL)),
  ADD CONSTRAINT payments_failed CHECK ((status = 'FAILED') = (failure_reason IS NOT NULL)),
  ADD CONSTRAINT payments_cash_in_session CHECK (method <> 'CASH' OR session_id IS NOT NULL),
  ADD CONSTRAINT payments_verification CHECK (verification = 'MANUAL'),
  -- No card numbers (13-19 consecutive digits) or other long secrets in references.
  ADD CONSTRAINT payments_reference CHECK (reference IS NULL OR (length(reference) BETWEEN 1 AND 100 AND reference !~ '[0-9]{13,19}'));
ALTER TABLE refunds
  ADD CONSTRAINT refunds_amount CHECK (amount_minor > 0),
  ADD CONSTRAINT refunds_reason CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  ADD CONSTRAINT refunds_cash_in_session CHECK (method <> 'CASH' OR session_id IS NOT NULL);
ALTER TABLE sale_returns
  ADD CONSTRAINT sale_returns_reason CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  ADD CONSTRAINT sale_returns_restocked CHECK ((status = 'RESTOCKED') = (restocked_at IS NOT NULL AND restocked_by_user_id IS NOT NULL));
ALTER TABLE sale_return_lines ADD CONSTRAINT sale_return_lines_quantity CHECK (quantity > 0);

-- 3. Sales are posted complete, in one transaction, and never edited.
-- 3a. Lines can only be written in the transaction that created their sale, and each must point
--     at its own SALE movement (same branch and product, delta = -quantity).
CREATE FUNCTION app_sale_line_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE s record; m record;
BEGIN
  -- "Being posted" = the sale row was inserted by this very transaction (its xmin).
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.sale_id, NEW.line_no, NEW.product_id, NEW.quantity, NEW.unit_price_minor, NEW.line_total_minor, NEW.movement_id)
       IS DISTINCT FROM (OLD.id, OLD.sale_id, OLD.line_no, OLD.product_id, OLD.quantity, OLD.unit_price_minor, OLD.line_total_minor, OLD.movement_id)
       OR NEW.quantity_returned < OLD.quantity_returned THEN
      RAISE EXCEPTION 'sale_lines: posted lines are immutable (only returned quantities grow)' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  SELECT branch_id, xmin::text AS inserted_by INTO s FROM sales WHERE id = NEW.sale_id;
  IF NOT FOUND OR s.inserted_by <> (pg_current_xact_id()::text::bigint % 4294967296)::text THEN
    RAISE EXCEPTION 'sale_lines: lines can only be added while the sale is being posted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO m FROM stock_movements WHERE id = NEW.movement_id;
  IF m IS NULL OR m.type::text <> 'SALE' OR m.branch_id <> s.branch_id OR m.product_id <> NEW.product_id OR m.quantity_delta <> -NEW.quantity
     OR m.source_id IS DISTINCT FROM NEW.sale_id THEN
    RAISE EXCEPTION 'sale_lines: each line must be backed by its own SALE stock movement' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER sale_lines_guard BEFORE INSERT OR UPDATE ON sale_lines FOR EACH ROW EXECUTE FUNCTION app_sale_line_guard();

-- 3b. At commit, a sale's total equals the sum of its lines and it has at least one line.
CREATE FUNCTION app_sale_total_check() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE total bigint; n int;
BEGIN
  SELECT COALESCE(sum(line_total_minor), 0), count(*) INTO total, n FROM sale_lines WHERE sale_id = NEW.id;
  IF n = 0 OR total <> NEW.total_minor THEN
    RAISE EXCEPTION 'sales: total % does not match its % line(s) (sum %)', NEW.total_minor, n, total USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER sales_total_matches_lines AFTER INSERT ON sales DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_sale_total_check();

-- 3c. Only the void transition changes a posted sale.
CREATE FUNCTION app_sale_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.organization_id, NEW.branch_id, NEW.session_id, NEW.customer_id, NEW.number, NEW.idempotency_key, NEW.currency,
      NEW.total_minor, NEW.related_return_id, NEW.cashier_user_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.branch_id, OLD.session_id, OLD.customer_id, OLD.number, OLD.idempotency_key, OLD.currency,
      OLD.total_minor, OLD.related_return_id, OLD.cashier_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'sales: a posted sale is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'COMPLETED' AND NEW.status = 'VOIDED') THEN
    RAISE EXCEPTION 'sales: invalid status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'VOIDED' THEN
    RAISE EXCEPTION 'sales: a voided sale is final' USING ERRCODE = 'check_violation';
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_guard BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION app_sale_guard();

-- 4. Payments: PENDING -> CONFIRMED | FAILED; refunded amount only grows (CHECK caps it).
CREATE FUNCTION app_payment_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.organization_id, NEW.sale_id, NEW.branch_id, NEW.session_id, NEW.method, NEW.amount_minor, NEW.reference, NEW.verification,
      NEW.idempotency_key, NEW.recorded_by_user_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.sale_id, OLD.branch_id, OLD.session_id, OLD.method, OLD.amount_minor, OLD.reference, OLD.verification,
      OLD.idempotency_key, OLD.recorded_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'payments: recorded payment details are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'PENDING' AND NEW.status IN ('CONFIRMED', 'FAILED')) THEN
    RAISE EXCEPTION 'payments: invalid status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.refunded_minor < OLD.refunded_minor THEN
    RAISE EXCEPTION 'payments: refunded amounts never decrease' USING ERRCODE = 'check_violation';
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;
CREATE TRIGGER payments_guard BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION app_payment_guard();

-- 5. Sessions: OPEN -> CLOSED once; identity immutable.
CREATE FUNCTION app_cashier_session_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.organization_id, NEW.branch_id, NEW.cashier_user_id, NEW.currency, NEW.opening_float_minor, NEW.opened_at)
     IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.branch_id, OLD.cashier_user_id, OLD.currency, OLD.opening_float_minor, OLD.opened_at) THEN
    RAISE EXCEPTION 'cashier_sessions: session identity is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'cashier_sessions: a closed session is final' USING ERRCODE = 'check_violation';
  END IF;
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;
CREATE TRIGGER cashier_sessions_guard BEFORE UPDATE ON cashier_sessions FOR EACH ROW EXECUTE FUNCTION app_cashier_session_guard();

-- 6. Returns: ACCEPTED -> RESTOCKED once.
CREATE FUNCTION app_sale_return_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.id, NEW.organization_id, NEW.sale_id, NEW.branch_id, NEW.idempotency_key, NEW.reason, NEW.accepted_by_user_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.sale_id, OLD.branch_id, OLD.idempotency_key, OLD.reason, OLD.accepted_by_user_id, OLD.created_at)
     OR NOT (OLD.status = 'ACCEPTED' AND NEW.status = 'RESTOCKED') THEN
    RAISE EXCEPTION 'sale_returns: an accepted return can only be restocked, once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER sale_returns_guard BEFORE UPDATE ON sale_returns FOR EACH ROW EXECUTE FUNCTION app_sale_return_guard();

CREATE TRIGGER refunds_append_only BEFORE UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER sale_return_lines_append_only BEFORE UPDATE OR DELETE ON sale_return_lines FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- 7. Privileges: nothing financial or historical can be deleted.
GRANT SELECT, INSERT, UPDATE ON customers, cashier_sessions, sales, sale_lines, payments, sale_returns TO ventidoc_app;
GRANT SELECT, INSERT ON refunds, sale_return_lines TO ventidoc_app;

-- 8. Tenant isolation: membership-bound policy, FORCEd.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'cashier_sessions', 'sales', 'sale_lines', 'payments', 'refunds', 'sale_returns', 'sale_return_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO ventidoc_app
      USING (organization_id = app_current_org_id() AND (SELECT app_is_active_member()))
      WITH CHECK (organization_id = app_current_org_id() AND (SELECT app_is_active_member()))', t);
  END LOOP;
END
$$;
