-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierReturnType" AS ENUM ('RETURN', 'RECEIPT_CORRECTION');

-- AlterEnum
ALTER TYPE "ProductStatus" ADD VALUE 'INACTIVE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'OPENING';
ALTER TYPE "StockMovementType" ADD VALUE 'RECEIPT';
ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_IN';
ALTER TYPE "StockMovementType" ADD VALUE 'COUNT';
ALTER TYPE "StockMovementType" ADD VALUE 'RETURN_TO_SUPPLIER';
ALTER TYPE "StockMovementType" ADD VALUE 'RECEIPT_CORRECTION';
ALTER TYPE "StockMovementType" ADD VALUE 'REVERSAL';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "category_id" UUID,
ADD COLUMN     "cost_price_minor" BIGINT,
ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'USD',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "quantity_scale" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "reorder_level" DECIMAL(18,3),
ADD COLUMN     "selling_price_minor" BIGINT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "counted_quantity" DECIMAL(18,3),
ADD COLUMN     "reverses_movement_id" UUID,
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "source_type" TEXT,
ADD COLUMN     "unit_cost_minor" BIGINT;

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "parent_id" UUID,
    "status" "CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "expected_quantity" DECIMAL(18,3) NOT NULL,
    "counted_quantity" DECIMAL(18,3) NOT NULL,
    "movement_id" UUID,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "from_branch_id" UUID NOT NULL,
    "to_branch_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "tax_id" TEXT,
    "payment_terms_days" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_products" (
    "organization_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "supplier_sku" TEXT,
    "default_unit_cost_minor" BIGINT,
    "lead_time_days" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("supplier_id","product_id")
);

-- CreateTable
CREATE TABLE "organization_sequences" (
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "organization_sequences_pkey" PRIMARY KEY ("organization_id","name")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "expected_date" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "self_approved" BOOLEAN NOT NULL DEFAULT false,
    "rejection_reason" TEXT,
    "issued_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "close_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity_ordered" DECIMAL(18,3) NOT NULL,
    "unit_cost_minor" BIGINT NOT NULL,
    "line_total_minor" BIGINT NOT NULL,
    "quantity_received" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantity_returned" DECIMAL(18,3) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "actor_user_id" UUID NOT NULL,
    "reason" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "note" TEXT,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "movement_id" UUID NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" "SupplierReturnType" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "line_id" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "movement_id" UUID NOT NULL,

    CONSTRAINT "supplier_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_organization_id_name_normalized_key" ON "product_categories"("organization_id", "name_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_id_organization_id_key" ON "product_categories"("id", "organization_id");

-- CreateIndex
CREATE INDEX "stock_counts_organization_id_branch_id_created_at_idx" ON "stock_counts"("organization_id", "branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_organization_id_idempotency_key_key" ON "stock_counts"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_id_organization_id_key" ON "stock_counts"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_count_id_product_id_key" ON "stock_count_lines"("count_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_transfers_organization_id_from_branch_id_created_at_idx" ON "stock_transfers"("organization_id", "from_branch_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_transfers_organization_id_to_branch_id_created_at_idx" ON "stock_transfers"("organization_id", "to_branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_organization_id_idempotency_key_key" ON "stock_transfers"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organization_id_code_key" ON "suppliers"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organization_id_name_normalized_key" ON "suppliers"("organization_id", "name_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_id_organization_id_key" ON "suppliers"("id", "organization_id");

-- CreateIndex
CREATE INDEX "supplier_products_organization_id_product_id_idx" ON "supplier_products"("organization_id", "product_id");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_status_created_at_idx" ON "purchase_orders"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "purchase_orders_organization_id_supplier_id_idx" ON "purchase_orders"("organization_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_organization_id_number_key" ON "purchase_orders"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_id_organization_id_key" ON "purchase_orders"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_line_no_key" ON "purchase_order_lines"("purchase_order_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_product_id_key" ON "purchase_order_lines"("purchase_order_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_id_organization_id_key" ON "purchase_order_lines"("id", "organization_id");

-- CreateIndex
CREATE INDEX "purchase_order_events_purchase_order_id_created_at_idx" ON "purchase_order_events"("purchase_order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_organization_id_idempotency_key_key" ON "goods_receipts"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_id_organization_id_key" ON "goods_receipts"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_lines_receipt_id_line_id_key" ON "goods_receipt_lines"("receipt_id", "line_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_organization_id_idempotency_key_key" ON "supplier_returns"("organization_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_id_organization_id_key" ON "supplier_returns"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_return_lines_return_id_line_id_key" ON "supplier_return_lines"("return_id", "line_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_barcode_key" ON "products"("organization_id", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_reverses_movement_id_key" ON "stock_movements"("reverses_movement_id");

-- CreateIndex
CREATE INDEX "stock_movements_source_type_source_id_idx" ON "stock_movements"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_id_organization_id_key" ON "stock_movements"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_organization_id_fkey" FOREIGN KEY ("parent_id", "organization_id") REFERENCES "product_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_organization_id_fkey" FOREIGN KEY ("category_id", "organization_id") REFERENCES "product_categories"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reverses_movement_id_fkey" FOREIGN KEY ("reverses_movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_organization_id_fkey" FOREIGN KEY ("count_id", "organization_id") REFERENCES "stock_counts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_organization_id_fkey" FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_movement_id_organization_id_fkey" FOREIGN KEY ("movement_id", "organization_id") REFERENCES "stock_movements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_organization_id_fkey" FOREIGN KEY ("from_branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_organization_id_fkey" FOREIGN KEY ("to_branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplier_id_organization_id_fkey" FOREIGN KEY ("supplier_id", "organization_id") REFERENCES "suppliers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_product_id_organization_id_fkey" FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_organization_id_fkey" FOREIGN KEY ("supplier_id", "organization_id") REFERENCES "suppliers"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_organization_id_fkey" FOREIGN KEY ("purchase_order_id", "organization_id") REFERENCES "purchase_orders"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_organization_id_fkey" FOREIGN KEY ("product_id", "organization_id") REFERENCES "products"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_events" ADD CONSTRAINT "purchase_order_events_purchase_order_id_organization_id_fkey" FOREIGN KEY ("purchase_order_id", "organization_id") REFERENCES "purchase_orders"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_organization_id_fkey" FOREIGN KEY ("purchase_order_id", "organization_id") REFERENCES "purchase_orders"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_organization_id_fkey" FOREIGN KEY ("receipt_id", "organization_id") REFERENCES "goods_receipts"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_line_id_organization_id_fkey" FOREIGN KEY ("line_id", "organization_id") REFERENCES "purchase_order_lines"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_movement_id_organization_id_fkey" FOREIGN KEY ("movement_id", "organization_id") REFERENCES "stock_movements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_purchase_order_id_organization_id_fkey" FOREIGN KEY ("purchase_order_id", "organization_id") REFERENCES "purchase_orders"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_branch_id_organization_id_fkey" FOREIGN KEY ("branch_id", "organization_id") REFERENCES "branches"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_return_id_organization_id_fkey" FOREIGN KEY ("return_id", "organization_id") REFERENCES "supplier_returns"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_line_id_organization_id_fkey" FOREIGN KEY ("line_id", "organization_id") REFERENCES "purchase_order_lines"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_lines" ADD CONSTRAINT "supplier_return_lines_movement_id_organization_id_fkey" FOREIGN KEY ("movement_id", "organization_id") REFERENCES "stock_movements"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written: catalogue integrity, the database-maintained stock ledger, suppliers and
-- purchasing (docs/architecture/11-inventory-purchasing.md).
-- Note: values added to existing enums in this migration cannot be used as enum literals in
-- the same transaction, so checks below compare `type::text`.
-- ===========================================================================

-- 1. Backfill (FORCE lifted for the owner only while fixing; see the phase 3 note).
ALTER TABLE products NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY;
UPDATE products p SET currency = o.default_currency FROM organizations o WHERE o.id = p.organization_id AND p.currency <> o.default_currency;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

-- 2. Integrity constraints.
ALTER TABLE products
  ADD CONSTRAINT products_quantity_scale CHECK (quantity_scale BETWEEN 0 AND 3),
  ADD CONSTRAINT products_prices CHECK ((cost_price_minor IS NULL OR cost_price_minor BETWEEN 0 AND 1000000000000000)
                                        AND (selling_price_minor IS NULL OR selling_price_minor BETWEEN 0 AND 1000000000000000)),
  ADD CONSTRAINT products_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT products_barcode CHECK (barcode IS NULL OR barcode ~ '^[A-Za-z0-9._-]{4,64}$'),
  ADD CONSTRAINT products_reorder_level CHECK (reorder_level IS NULL OR reorder_level >= 0),
  ADD CONSTRAINT products_version CHECK (version >= 1),
  ADD CONSTRAINT products_name_length CHECK (length(btrim(name)) BETWEEN 1 AND 200);
ALTER TABLE product_categories
  ADD CONSTRAINT product_categories_name CHECK (length(btrim(name)) BETWEEN 1 AND 120 AND name_normalized = lower(btrim(name))),
  ADD CONSTRAINT product_categories_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_count_quantity CHECK ((type::text = 'COUNT') = (counted_quantity IS NOT NULL)),
  ADD CONSTRAINT stock_movements_reversal_link CHECK ((type::text = 'REVERSAL') = (reverses_movement_id IS NOT NULL)),
  ADD CONSTRAINT stock_movements_source_type CHECK (source_type IS NULL OR source_type IN ('TRANSFER', 'COUNT', 'GOODS_RECEIPT', 'SUPPLIER_RETURN')),
  ADD CONSTRAINT stock_movements_unit_cost CHECK (unit_cost_minor IS NULL OR unit_cost_minor >= 0);
ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_note CHECK (length(btrim(note)) BETWEEN 3 AND 500);
ALTER TABLE stock_count_lines ADD CONSTRAINT stock_count_lines_quantities CHECK (expected_quantity >= 0 AND counted_quantity >= 0);
ALTER TABLE stock_transfers
  ADD CONSTRAINT stock_transfers_distinct_branches CHECK (from_branch_id <> to_branch_id),
  ADD CONSTRAINT stock_transfers_reason CHECK (length(btrim(reason)) BETWEEN 3 AND 500);
ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_code CHECK (code ~ '^[A-Za-z0-9._-]{1,32}$'),
  ADD CONSTRAINT suppliers_name CHECK (length(btrim(name)) BETWEEN 1 AND 200 AND name_normalized = lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))),
  ADD CONSTRAINT suppliers_email CHECK (email IS NULL OR (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+$')),
  ADD CONSTRAINT suppliers_terms CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365),
  ADD CONSTRAINT suppliers_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT suppliers_version CHECK (version >= 1);
ALTER TABLE supplier_products
  ADD CONSTRAINT supplier_products_cost CHECK (default_unit_cost_minor IS NULL OR default_unit_cost_minor BETWEEN 0 AND 1000000000000000),
  ADD CONSTRAINT supplier_products_lead_time CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365);
ALTER TABLE organization_sequences ADD CONSTRAINT organization_sequences_value CHECK (last_value >= 0);
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_currency CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT purchase_orders_subtotal CHECK (subtotal_minor >= 0),
  ADD CONSTRAINT purchase_orders_version CHECK (version >= 1),
  ADD CONSTRAINT purchase_orders_submitted CHECK (status IN ('DRAFT') OR status = 'CANCELLED' OR submitted_by_user_id IS NOT NULL),
  -- Separation of duties: an approval is by someone other than the submitter, unless the
  -- approver held purchasing.order.self_approve (recorded in self_approved).
  ADD CONSTRAINT purchase_orders_approval CHECK (
    status NOT IN ('APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED')
    OR (decided_by_user_id IS NOT NULL AND (decided_by_user_id <> submitted_by_user_id OR self_approved))),
  ADD CONSTRAINT purchase_orders_rejection CHECK (status <> 'REJECTED' OR (decided_by_user_id IS NOT NULL AND length(btrim(rejection_reason)) >= 3));
ALTER TABLE purchase_order_lines
  ADD CONSTRAINT purchase_order_lines_quantities CHECK (quantity_ordered > 0 AND quantity_received >= 0 AND quantity_returned >= 0
    AND quantity_received <= quantity_ordered AND quantity_returned <= quantity_received),
  ADD CONSTRAINT purchase_order_lines_cost CHECK (unit_cost_minor BETWEEN 0 AND 1000000000000000),
  -- Totals are never trusted from clients: the database checks the arithmetic.
  ADD CONSTRAINT purchase_order_lines_total CHECK (line_total_minor = round(quantity_ordered * unit_cost_minor)),
  ADD CONSTRAINT purchase_order_lines_line_no CHECK (line_no >= 1);
ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_quantity CHECK (quantity > 0);
ALTER TABLE supplier_return_lines ADD CONSTRAINT supplier_return_lines_quantity CHECK (quantity > 0);
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_reason CHECK (length(btrim(reason)) BETWEEN 3 AND 500);

-- 3. The stock ledger posts itself. Every movement INSERT:
--    - checks the quantity precision of the product's unit and that the branch is ACTIVE,
--    - locks the balance row (created at zero on first use),
--    - for COUNT, derives quantity_delta from counted_quantity against the LOCKED balance
--      (no difference: the row is skipped),
--    - refuses a negative result (insufficient_stock),
--    - updates the balance, stores balance_after and stamps created_at under the lock.
--    Balances therefore change only through ledger rows, atomically with them, and the runtime
--    role has no write privilege on stock_balances at all. SECURITY DEFINER (owned by
--    ventidoc_rls) because of that; the movement row itself is still checked by RLS and by its
--    composite foreign keys, and any failure aborts the whole statement, balance update included.
CREATE FUNCTION app_stock_post_movement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  scale int;
  current numeric(18,3);
  next numeric(18,3);
BEGIN
  SELECT p.quantity_scale INTO scale FROM products p WHERE p.id = NEW.product_id AND p.organization_id = NEW.organization_id;
  IF scale IS NULL THEN
    RAISE EXCEPTION 'stock_movements: unknown product' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = NEW.branch_id AND b.organization_id = NEW.organization_id AND b.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'branch_archived: the branch accepts no new stock movements' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO stock_balances (organization_id, branch_id, product_id, quantity, updated_at)
    VALUES (NEW.organization_id, NEW.branch_id, NEW.product_id, 0, now())
    ON CONFLICT (branch_id, product_id) DO NOTHING;
  SELECT sb.quantity INTO current FROM stock_balances sb WHERE sb.branch_id = NEW.branch_id AND sb.product_id = NEW.product_id FOR UPDATE;
  IF NEW.type::text = 'COUNT' THEN
    IF NEW.counted_quantity <> round(NEW.counted_quantity, scale) THEN
      RAISE EXCEPTION 'quantity_precision: % allows % decimal place(s)', NEW.product_id, scale USING ERRCODE = 'check_violation';
    END IF;
    NEW.quantity_delta := NEW.counted_quantity - current;
    IF NEW.quantity_delta = 0 THEN
      RETURN NULL; -- the count matches: nothing to post
    END IF;
  END IF;
  IF NEW.quantity_delta <> round(NEW.quantity_delta, scale) THEN
    RAISE EXCEPTION 'quantity_precision: % allows % decimal place(s)', NEW.product_id, scale USING ERRCODE = 'check_violation';
  END IF;
  next := current + NEW.quantity_delta;
  IF next < 0 THEN
    RAISE EXCEPTION 'insufficient_stock: available %', current USING ERRCODE = 'check_violation';
  END IF;
  UPDATE stock_balances SET quantity = next, updated_at = now() WHERE branch_id = NEW.branch_id AND product_id = NEW.product_id;
  NEW.balance_after := next;
  -- Stamped under the balance lock: ledger order is posting order, so each row's balance_after
  -- follows the previous one (now() would be the transaction start and could interleave).
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END
$$;
CREATE TRIGGER stock_movements_post BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION app_stock_post_movement();

-- A reversal must exactly cancel an ADJUSTMENT, OPENING or COUNT of the same product and branch.
CREATE FUNCTION app_stock_reversal_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE o record;
BEGIN
  IF NEW.type::text <> 'REVERSAL' THEN RETURN NEW; END IF;
  SELECT * INTO o FROM stock_movements m WHERE m.id = NEW.reverses_movement_id;
  IF o IS NULL OR o.organization_id <> NEW.organization_id OR o.branch_id <> NEW.branch_id OR o.product_id <> NEW.product_id
     OR o.type::text NOT IN ('ADJUSTMENT', 'OPENING', 'COUNT') OR NEW.quantity_delta <> -o.quantity_delta THEN
    RAISE EXCEPTION 'stock_movements: a reversal must exactly cancel an adjustment, opening balance or count' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
-- Runs before the posting trigger (triggers fire in name order).
CREATE TRIGGER stock_movements_a_reversal_guard BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION app_stock_reversal_guard();

-- 4. Purchase orders: valid transitions, immutable identity, server-managed version.
CREATE FUNCTION app_purchase_order_transition_ok(old_status text, new_status text) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$
    SELECT old_status = new_status OR CASE old_status
      WHEN 'DRAFT'              THEN new_status IN ('SUBMITTED', 'CANCELLED')
      WHEN 'SUBMITTED'          THEN new_status IN ('APPROVED', 'REJECTED', 'CANCELLED')
      WHEN 'REJECTED'           THEN new_status IN ('DRAFT', 'CANCELLED')
      WHEN 'APPROVED'           THEN new_status IN ('ISSUED', 'CANCELLED')
      WHEN 'ISSUED'             THEN new_status IN ('PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')
      WHEN 'PARTIALLY_RECEIVED' THEN new_status IN ('ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED')
      WHEN 'RECEIVED'           THEN new_status IN ('PARTIALLY_RECEIVED', 'ISSUED')
      ELSE false -- CLOSED and CANCELLED are terminal
    END
  $$;

CREATE FUNCTION app_purchase_order_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'purchase_orders: identity columns are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT app_purchase_order_transition_ok(OLD.status::text, NEW.status::text) THEN
    RAISE EXCEPTION 'purchase_orders: invalid status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status::text NOT IN ('DRAFT', 'REJECTED')
     AND (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.currency IS DISTINCT FROM OLD.currency) THEN
    RAISE EXCEPTION 'purchase_orders: supplier, branch and currency change only while editable' USING ERRCODE = 'check_violation';
  END IF;
  -- The version is server-managed: any change other than the database-maintained subtotal
  -- (recomputed from the lines) is a new version, and so is an explicit bump by the API (a
  -- line-only edit). It always becomes exactly OLD + 1: clients cannot choose a version.
  IF to_jsonb(NEW) - 'subtotal_minor' - 'updated_at' - 'version' IS DISTINCT FROM to_jsonb(OLD) - 'subtotal_minor' - 'updated_at' - 'version'
     OR NEW.version <> OLD.version THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER purchase_orders_guard BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION app_purchase_order_guard();

-- Lines: ordering terms change only while the order is editable; received/returned quantities
-- only while it is being received; quantities respect the product's unit precision.
CREATE FUNCTION app_purchase_order_line_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  st text;
  scale int;
  r record := COALESCE(NEW, OLD);
BEGIN
  SELECT po.status::text INTO st FROM purchase_orders po WHERE po.id = r.purchase_order_id;
  IF TG_OP IN ('INSERT', 'DELETE')
     OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.quantity_ordered IS DISTINCT FROM OLD.quantity_ordered
     OR NEW.unit_cost_minor IS DISTINCT FROM OLD.unit_cost_minor OR NEW.line_no IS DISTINCT FROM OLD.line_no THEN
    IF st NOT IN ('DRAFT', 'REJECTED') THEN
      RAISE EXCEPTION 'purchase_order_lines: lines change only while the order is a draft' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.quantity_received IS DISTINCT FROM OLD.quantity_received OR NEW.quantity_returned IS DISTINCT FROM OLD.quantity_returned)
     AND st NOT IN ('ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') THEN
    RAISE EXCEPTION 'purchase_order_lines: goods can be received or returned only on an issued order' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT p.quantity_scale INTO scale FROM products p WHERE p.id = NEW.product_id;
    IF NEW.quantity_ordered <> round(NEW.quantity_ordered, scale) OR NEW.quantity_received <> round(NEW.quantity_received, scale)
       OR NEW.quantity_returned <> round(NEW.quantity_returned, scale) THEN
      RAISE EXCEPTION 'quantity_precision: % allows % decimal place(s)', NEW.product_id, scale USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;
CREATE TRIGGER purchase_order_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON purchase_order_lines FOR EACH ROW EXECUTE FUNCTION app_purchase_order_line_guard();

-- The subtotal is the sum of the lines, maintained by the database.
CREATE FUNCTION app_purchase_order_subtotal() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE po uuid := COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
BEGIN
  UPDATE purchase_orders SET subtotal_minor = (SELECT COALESCE(sum(l.line_total_minor), 0) FROM purchase_order_lines l WHERE l.purchase_order_id = po)
    WHERE id = po;
  RETURN NULL;
END
$$;
CREATE TRIGGER purchase_order_lines_subtotal AFTER INSERT OR UPDATE OF line_total_minor OR DELETE ON purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION app_purchase_order_subtotal();

-- Append-only history and postings (app_reject_mutation from the security foundation).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_order_events', 'goods_receipts', 'goods_receipt_lines', 'supplier_returns', 'supplier_return_lines',
                           'stock_counts', 'stock_count_lines', 'stock_transfers'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_reject_mutation()', t || '_append_only', t);
  END LOOP;
END
$$;

-- 5. Privileges. Balances are written only by the ledger trigger; catalogue records, suppliers
--    and orders are archived/cancelled, never deleted; postings are insert-only.
REVOKE INSERT, UPDATE, DELETE ON stock_balances FROM ventidoc_app;
REVOKE DELETE ON products FROM ventidoc_app;
GRANT SELECT, INSERT, UPDATE ON stock_balances TO ventidoc_rls;
GRANT SELECT ON products, branches, stock_movements TO ventidoc_rls;
GRANT CREATE ON SCHEMA public TO ventidoc_rls;
ALTER FUNCTION app_stock_post_movement() OWNER TO ventidoc_rls;
REVOKE CREATE ON SCHEMA public FROM ventidoc_rls;
REVOKE EXECUTE ON FUNCTION app_stock_post_movement() FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON product_categories, suppliers, organization_sequences, purchase_orders TO ventidoc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_products, purchase_order_lines TO ventidoc_app;
GRANT SELECT, INSERT ON purchase_order_events, goods_receipts, goods_receipt_lines, supplier_returns, supplier_return_lines,
  stock_counts, stock_count_lines, stock_transfers TO ventidoc_app;

-- 6. Tenant isolation: the same membership-bound policy as every other business table, FORCEd.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_categories', 'suppliers', 'supplier_products', 'organization_sequences', 'purchase_orders',
                           'purchase_order_lines', 'purchase_order_events', 'goods_receipts', 'goods_receipt_lines', 'supplier_returns',
                           'supplier_return_lines', 'stock_counts', 'stock_count_lines', 'stock_transfers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO ventidoc_app
      USING (organization_id = app_current_org_id() AND (SELECT app_is_active_member()))
      WITH CHECK (organization_id = app_current_org_id() AND (SELECT app_is_active_member()))', t);
  END LOOP;
END
$$;
