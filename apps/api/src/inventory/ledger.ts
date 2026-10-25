import { HttpStatus } from '@nestjs/common';
import { ApiError, Errors } from '../common/errors';
import type { Tx } from '../database/tenant-db.service';
import { Prisma } from '../generated/prisma/client';

/**
 * The only way stock changes. Inserting a stock_movements row makes the database
 * (trigger app_stock_post_movement) lock and update the balance atomically, check the
 * branch is active, the unit precision and that the result is not negative, and fill in
 * balance_after (and, for counts, the delta). The runtime role cannot write balances.
 */
export type MovementType =
  | 'ADJUSTMENT' | 'OPENING' | 'RECEIPT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'COUNT' | 'RETURN_TO_SUPPLIER' | 'RECEIPT_CORRECTION' | 'REVERSAL'
  | 'SALE' | 'SALE_RETURN' | 'SALE_VOID';

export interface MovementInput {
  organizationId: string;
  branchId: string;
  productId: string;
  type: MovementType;
  /** Signed. Omitted for COUNT (derived from countedQuantity against the locked balance). */
  quantityDelta?: Prisma.Decimal;
  countedQuantity?: Prisma.Decimal;
  reason: string;
  actorUserId: string;
  /** Unique per organization: the duplicate-posting guard. */
  idempotencyKey: string;
  sourceType?: 'TRANSFER' | 'COUNT' | 'GOODS_RECEIPT' | 'SUPPLIER_RETURN' | 'SALE' | 'SALE_RETURN' | 'SALE_VOID';
  sourceId?: string;
  reversesMovementId?: string;
  unitCostMinor?: bigint | null;
}

export interface PostedMovement {
  id: string;
  branchId: string;
  productId: string;
  type: string;
  quantityDelta: string;
  balanceAfter: string;
  createdAt: Date;
}

/** Thrown when an idempotency key (or a once-only link such as a reversal) is already used. */
export class DuplicatePosting extends Error {}

const errorText = (e: unknown) => {
  if (e instanceof Error) {
    const meta = (e as { meta?: unknown }).meta;
    return `${e.message} ${meta ? JSON.stringify(meta) : ''}`;
  }
  return String(e);
};

export function isUniqueViolation(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return true;
  return /23505|duplicate key value|unique constraint/i.test(errorText(e));
}

/** Maps the ledger trigger's refusals to API errors. */
function mapLedgerError(e: unknown): never {
  const text = errorText(e);
  const insufficient = /insufficient_stock: available (-?[0-9.]+)/.exec(text);
  if (insufficient) throw Errors.conflict('insufficient_stock', `Only ${new Prisma.Decimal(insufficient[1]).toFixed(3)} in stock`);
  if (/branch_archived/.test(text)) throw Errors.conflict('branch_archived', 'This branch is archived and accepts no new transactions');
  if (/quantity_precision/.test(text)) throw Errors.badRequest('invalid_quantity_precision', "A quantity has more decimal places than the product's unit allows");
  if (/a reversal must exactly cancel/.test(text)) throw Errors.conflict('not_reversible', 'Only adjustments, opening balances and counts can be reversed');
  if (isUniqueViolation(e)) throw new DuplicatePosting();
  throw e;
}

/**
 * Posts movements in a fixed order (branch, then product), so concurrent multi-line
 * operations lock balance rows in the same order and cannot deadlock. Returns results in
 * input order; null for a COUNT line that matched the balance (nothing posted).
 */
export async function postMovements(tx: Tx, inputs: MovementInput[]): Promise<(PostedMovement | null)[]> {
  const order = inputs.map((m, i) => ({ m, i })).sort((a, b) =>
    a.m.branchId === b.m.branchId ? (a.m.productId < b.m.productId ? -1 : a.m.productId > b.m.productId ? 1 : a.i - b.i)
      : a.m.branchId < b.m.branchId ? -1 : 1);
  const out: (PostedMovement | null)[] = new Array(inputs.length).fill(null);
  for (const { m, i } of order) {
    const delta = m.type === 'COUNT' ? '1' : m.quantityDelta!.toFixed(3); // COUNT: the database derives the delta
    let rows: { id: string; branch_id: string; product_id: string; type: string; quantity_delta: string; balance_after: string; created_at: Date }[];
    try {
      rows = await tx.$queryRaw`
        INSERT INTO stock_movements (organization_id, branch_id, product_id, type, quantity_delta, counted_quantity, balance_after, reason,
                                     actor_user_id, idempotency_key, source_type, source_id, reverses_movement_id, unit_cost_minor)
        VALUES (${m.organizationId}::uuid, ${m.branchId}::uuid, ${m.productId}::uuid, ${m.type}::"StockMovementType", ${delta}::numeric,
                ${m.countedQuantity ? m.countedQuantity.toFixed(3) : null}::numeric, 0, ${m.reason}, ${m.actorUserId}::uuid, ${m.idempotencyKey},
                ${m.sourceType ?? null}, ${m.sourceId ?? null}::uuid, ${m.reversesMovementId ?? null}::uuid, ${m.unitCostMinor ?? null}::bigint)
        RETURNING id, branch_id, product_id, type::text AS type, quantity_delta::text AS quantity_delta, balance_after::text AS balance_after, created_at`;
    } catch (e) {
      mapLedgerError(e);
    }
    const r = rows[0];
    out[i] = r ? {
      id: r.id, branchId: r.branch_id, productId: r.product_id, type: r.type,
      quantityDelta: new Prisma.Decimal(r.quantity_delta).toFixed(3), balanceAfter: new Prisma.Decimal(r.balance_after).toFixed(3), createdAt: r.created_at,
    } : null;
  }
  return out;
}

/** Client-supplied Idempotency-Key header (required on every posting route). */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
export function requireIdempotencyKey(key: string | undefined): string {
  if (!key || !IDEMPOTENCY_KEY.test(key)) {
    throw Errors.badRequest('idempotency_key_required', 'Send an Idempotency-Key header (8-128 characters of [A-Za-z0-9_-])');
  }
  return key;
}

export const idempotencyReused = () =>
  new ApiError(HttpStatus.CONFLICT, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request');
