import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { decodeCursor, decodeKeyCursor, encodeCursor, encodeKeyCursor, escapeLike } from '../common/cursor';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { can, type EffectiveAccess } from '../authz/permission-evaluator';
import { EntitlementService } from '../subscriptions/entitlement.service';
import type {
  ListBalancesQuery, ListMovementsQuery, OpeningBalanceDto, ReverseMovementDto, StockAdjustmentDto, StockCountDto, StockTransferDto,
} from './dto/inventory.dto';
import { DuplicatePosting, idempotencyReused, MovementInput, PostedMovement, postMovements, requireIdempotencyKey } from './ledger';
import { fmtMinor, fmtQty, parseMinor, parseQuantity } from './quantity';

type MovementRow = Prisma.StockMovementGetPayload<object>;

/**
 * Stock operations at a branch. Every change is a stock_movements row; the database posts it
 * to the balance in the same statement (see ledger.ts). Each operation is idempotent: a client
 * Idempotency-Key (or, for once-only operations, a key derived from the operation itself)
 * is unique per organization, so retries and concurrent duplicates post once.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
  ) {}

  // ---------------------------------------------------------------- reads

  listBalances(access: EffectiveAccess, branchId: string, query: ListBalancesQuery = {}) {
    const limit = query.limit ?? 100;
    const cursor = decodeKeyCursor(query.cursor);
    const q = query.q?.trim();
    return this.db.inOrg(access, async (tx) => {
      await this.requireBranch(tx, branchId);
      const rows = await tx.stockBalance.findMany({
        where: {
          branchId,
          ...(q ? { product: { OR: [{ name: { contains: escapeLike(q), mode: 'insensitive' } }, { sku: { contains: escapeLike(q), mode: 'insensitive' } }] } } : {}),
          ...(cursor ? { OR: [{ product: { name: { gt: cursor.key } } }, { product: { name: cursor.key }, productId: { gt: cursor.id } }] } : {}),
        },
        select: { quantity: true, updatedAt: true, productId: true, product: { select: { id: true, sku: true, name: true, unit: true, reorderLevel: true, status: true } } },
        orderBy: [{ product: { name: 'asc' } }, { productId: 'asc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({
          product: { id: r.product.id, sku: r.product.sku, name: r.product.name, unit: r.product.unit, status: r.product.status },
          quantity: r.quantity.toFixed(3), reorderLevel: r.product.reorderLevel === null ? null : fmtQty(r.product.reorderLevel),
          low: r.product.reorderLevel !== null && r.quantity.lessThanOrEqualTo(r.product.reorderLevel), updatedAt: r.updatedAt,
        })),
        nextCursor: rows.length > limit ? encodeKeyCursor({ key: last.product.name, id: last.productId }) : null,
      };
    });
  }

  listMovements(access: EffectiveAccess, branchId: string, query: ListMovementsQuery = {}) {
    const limit = query.limit ?? 100;
    const cursor = decodeCursor(query.cursor);
    return this.db.inOrg(access, async (tx) => {
      await this.requireBranch(tx, branchId);
      const rows = await tx.stockMovement.findMany({
        where: {
          branchId,
          ...(query.productId ? { productId: query.productId } : {}),
          ...(query.type ? { type: query.type as MovementRow['type'] } : {}),
          ...(cursor ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { items: page.map((m) => serializeMovement(access, m)), nextCursor: rows.length > limit ? encodeCursor({ at: last.createdAt, id: last.id }) : null };
    });
  }

  /** Products at or below their reorder level (no balance row = 0). */
  lowStock(access: EffectiveAccess, branchId: string) {
    return this.db.inOrg(access, async (tx) => {
      await this.requireBranch(tx, branchId);
      const rows = await tx.$queryRaw<{ id: string; sku: string; name: string; unit: string; quantity: string; reorder_level: string }[]>`
        SELECT p.id, p.sku, p.name, p.unit, COALESCE(b.quantity, 0)::text AS quantity, p.reorder_level::text AS reorder_level
        FROM products p
        LEFT JOIN stock_balances b ON b.product_id = p.id AND b.branch_id = ${branchId}::uuid
        WHERE p.reorder_level IS NOT NULL AND p.status <> 'ARCHIVED' AND COALESCE(b.quantity, 0) <= p.reorder_level
        ORDER BY p.name, p.id LIMIT 1000`;
      return { items: rows.map((r) => ({ product: { id: r.id, sku: r.sku, name: r.name, unit: r.unit }, quantity: fmtQty(r.quantity), reorderLevel: fmtQty(r.reorder_level) })) };
    });
  }

  /**
   * Verifies the ledger: for every product at the branch, the balance must equal the sum of
   * its movements and the last movement's balance_after. Any discrepancy is listed.
   */
  reconciliation(access: EffectiveAccess, branchId: string) {
    return this.db.inOrg(access, async (tx) => {
      await this.requireBranch(tx, branchId);
      const rows = await tx.$queryRaw<{ product_id: string; balance: string; ledger: string; last_after: string | null; movements: number }[]>`
        SELECT b.product_id, b.quantity::text AS balance, COALESCE(sum(m.quantity_delta), 0)::text AS ledger,
               (SELECT m2.balance_after::text FROM stock_movements m2 WHERE m2.branch_id = b.branch_id AND m2.product_id = b.product_id
                ORDER BY m2.created_at DESC, m2.id DESC LIMIT 1) AS last_after,
               count(m.id)::int AS movements
        FROM stock_balances b LEFT JOIN stock_movements m ON m.branch_id = b.branch_id AND m.product_id = b.product_id
        WHERE b.branch_id = ${branchId}::uuid
        GROUP BY b.branch_id, b.product_id, b.quantity`;
      const discrepancies = rows
        .filter((r) => !new Prisma.Decimal(r.balance).equals(r.ledger) || (r.last_after !== null && !new Prisma.Decimal(r.balance).equals(r.last_after)))
        .map((r) => ({ productId: r.product_id, balance: fmtQty(r.balance), ledgerSum: fmtQty(r.ledger), lastBalanceAfter: r.last_after && fmtQty(r.last_after) }));
      return { branchId, productsChecked: rows.length, movements: rows.reduce((n, r) => n + r.movements, 0), consistent: discrepancies.length === 0, discrepancies };
    });
  }

  // ---------------------------------------------------------------- postings

  /** A signed adjustment with a mandatory reason. */
  async adjust(access: EffectiveAccess, branchId: string, dto: StockAdjustmentDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    return this.postOnce(access, key, async (tx) => {
      const product = await this.requireProduct(tx, dto.productId, { allowInactive: true });
      const delta = parseQuantity(dto.quantityDelta, product.quantityScale, 'nonzero', 'quantityDelta');
      await this.requireBranch(tx, branchId, { active: true });
      const [m] = await postMovements(tx, [{
        organizationId: access.organizationId, branchId, productId: product.id, type: 'ADJUSTMENT', quantityDelta: delta,
        reason: dto.reason.trim(), actorUserId: access.userId, idempotencyKey: key,
      }]);
      await this.audit.record(tx, {
        action: 'inventory.stock.adjusted', resourceType: 'stock_movement', resourceId: m!.id, organizationId: access.organizationId, branchId,
        actorUserId: access.userId, before: { quantity: fmtQty(new Prisma.Decimal(m!.balanceAfter).minus(delta)) }, after: { quantity: m!.balanceAfter },
        metadata: { productId: product.id, delta: delta.toFixed(3), reason: dto.reason.trim() },
      }, meta);
      return { replayed: false, movement: posted(m!, dto.reason.trim(), access.userId) };
    }, async (tx) => {
      const existing = await tx.stockMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } } });
      if (!existing) return null;
      if (existing.branchId !== branchId || existing.productId !== dto.productId || existing.type !== 'ADJUSTMENT'
          || !QUANTITY_OK(dto.quantityDelta) || !existing.quantityDelta.equals(dto.quantityDelta)) throw idempotencyReused();
      return { replayed: true, movement: serializeMovement(access, existing) };
    });
  }

  /**
   * The first stock of a product at a branch. Once only (the key is derived from the branch
   * and product, so concurrent requests post once), and only before any other movement.
   */
  async opening(access: EffectiveAccess, branchId: string, dto: OpeningBalanceDto, meta: RequestMeta) {
    const cost = parseMinor(dto.unitCostMinor, 'unitCostMinor');
    if (cost !== null && !can(access, 'inventory.cost.read')) throw Errors.forbidden('Recording a cost requires inventory.cost.read');
    const key = `opening:${branchId}:${dto.productId}`;
    return this.postOnce(access, key, async (tx) => {
      const product = await this.requireProduct(tx, dto.productId, { allowInactive: false });
      const quantity = parseQuantity(dto.quantity, product.quantityScale, 'positive');
      await this.requireBranch(tx, branchId, { active: true });
      if (await tx.stockMovement.count({ where: { branchId, productId: product.id } })) {
        throw Errors.conflict('stock_history_exists', 'This product already has stock movements at this branch; use an adjustment or a count');
      }
      const [m] = await postMovements(tx, [{
        organizationId: access.organizationId, branchId, productId: product.id, type: 'OPENING', quantityDelta: quantity,
        reason: dto.reason.trim(), actorUserId: access.userId, idempotencyKey: key, unitCostMinor: cost,
      }]);
      await this.audit.record(tx, {
        action: 'inventory.stock.opening_balance', resourceType: 'stock_movement', resourceId: m!.id, organizationId: access.organizationId, branchId,
        actorUserId: access.userId, after: { quantity: m!.balanceAfter }, metadata: { productId: product.id, reason: dto.reason.trim() },
      }, meta);
      return { replayed: false, movement: posted(m!, dto.reason.trim(), access.userId) };
    }, async (tx) => {
      const existing = await tx.stockMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } } });
      if (!existing) return null;
      if (!QUANTITY_OK(dto.quantity) || !existing.quantityDelta.equals(dto.quantity)) throw Errors.conflict('opening_balance_exists', 'An opening balance was already recorded for this product here');
      return { replayed: true, movement: serializeMovement(access, existing) };
    });
  }

  /**
   * A physical count. For each line the database compares the counted quantity with the
   * balance it has locked, and posts the difference (nothing when they match).
   */
  async count(access: EffectiveAccess, branchId: string, dto: StockCountDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    if (new Set(dto.lines.map((l) => l.productId)).size !== dto.lines.length) throw Errors.badRequest('duplicate_lines', 'Each product may appear once per count');
    return this.postOnce(access, key, async (tx) => {
      await this.requireBranch(tx, branchId, { active: true });
      const products = await this.requireProducts(tx, dto.lines.map((l) => l.productId), { allowInactive: true });
      const counted = dto.lines.map((l) => parseQuantity(l.countedQuantity, products.get(l.productId)!.quantityScale, 'nonnegative', 'countedQuantity'));
      const header = await tx.stockCount.create({ data: { organizationId: access.organizationId, branchId, idempotencyKey: key, note: dto.note.trim(), actorUserId: access.userId } });
      const results = await postMovements(tx, dto.lines.map((l, i) => ({
        organizationId: access.organizationId, branchId, productId: l.productId, type: 'COUNT' as const, countedQuantity: counted[i],
        reason: dto.note.trim(), actorUserId: access.userId, idempotencyKey: `count:${header.id}:${l.productId}`, sourceType: 'COUNT' as const, sourceId: header.id,
      })));
      await tx.stockCountLine.createMany({
        data: dto.lines.map((l, i) => ({
          organizationId: access.organizationId, countId: header.id, productId: l.productId, countedQuantity: counted[i],
          // Posted: expected = counted - delta. Matched (nothing posted): expected = counted.
          expectedQuantity: results[i] ? counted[i].minus(results[i]!.quantityDelta) : counted[i], movementId: results[i]?.id ?? null,
        })),
      });
      await this.audit.record(tx, {
        action: 'inventory.stock.counted', resourceType: 'stock_count', resourceId: header.id, organizationId: access.organizationId, branchId,
        actorUserId: access.userId, metadata: { lines: dto.lines.length, differences: results.filter(Boolean).length },
      }, meta);
      return { replayed: false, count: await this.loadCount(tx, access, header.id) };
    }, async (tx) => {
      const existing = await tx.stockCount.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } } });
      if (!existing) return null;
      if (existing.branchId !== branchId) throw idempotencyReused();
      return { replayed: true, count: await this.loadCount(tx, access, existing.id) };
    });
  }

  getCount(access: EffectiveAccess, branchId: string, countId: string) {
    return this.db.inOrg(access, async (tx) => {
      const c = await tx.stockCount.findFirst({ where: { id: countId, branchId }, select: { id: true } });
      if (!c) throw Errors.notFound('Stock count');
      return this.loadCount(tx, access, c.id);
    });
  }

  /**
   * Immediate transfer between two active branches (out and in post in one transaction).
   * Requires inventory.stock.transfer at both branches (the guard checks the source).
   */
  async transfer(access: EffectiveAccess, fromBranchId: string, dto: StockTransferDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    if (new Set(dto.lines.map((l) => l.productId)).size !== dto.lines.length) throw Errors.badRequest('duplicate_lines', 'Each product may appear once per transfer');
    return this.postOnce(access, key, async (tx) => {
      // Branches are resolved under RLS first: another organization's IDs are simply not found.
      await this.requireBranch(tx, fromBranchId, { active: true });
      if (dto.toBranchId === fromBranchId) throw Errors.badRequest('same_branch', 'Source and destination must differ');
      await this.requireBranch(tx, dto.toBranchId, { active: true });
      if (!can(access, 'inventory.stock.transfer', dto.toBranchId)) throw Errors.forbidden('You cannot transfer stock into that branch');
      const products = await this.requireProducts(tx, dto.lines.map((l) => l.productId), { allowInactive: true });
      const qty = dto.lines.map((l) => parseQuantity(l.quantity, products.get(l.productId)!.quantityScale, 'positive'));
      const header = await tx.stockTransfer.create({
        data: { organizationId: access.organizationId, fromBranchId, toBranchId: dto.toBranchId, idempotencyKey: key, reason: dto.reason.trim(), actorUserId: access.userId },
      });
      const inputs: MovementInput[] = dto.lines.flatMap((l, i) => [
        { organizationId: access.organizationId, branchId: fromBranchId, productId: l.productId, type: 'TRANSFER_OUT' as const, quantityDelta: qty[i].negated(),
          reason: dto.reason.trim(), actorUserId: access.userId, idempotencyKey: `transfer:${header.id}:${l.productId}:out`, sourceType: 'TRANSFER' as const, sourceId: header.id },
        { organizationId: access.organizationId, branchId: dto.toBranchId, productId: l.productId, type: 'TRANSFER_IN' as const, quantityDelta: qty[i],
          reason: dto.reason.trim(), actorUserId: access.userId, idempotencyKey: `transfer:${header.id}:${l.productId}:in`, sourceType: 'TRANSFER' as const, sourceId: header.id },
      ]);
      await postMovements(tx, inputs);
      await this.audit.record(tx, {
        action: 'inventory.stock.transferred', resourceType: 'stock_transfer', resourceId: header.id, organizationId: access.organizationId, branchId: fromBranchId,
        actorUserId: access.userId, metadata: { toBranchId: dto.toBranchId, lines: dto.lines.map((l, i) => ({ productId: l.productId, quantity: qty[i].toFixed(3) })) },
      }, meta);
      return { replayed: false, transfer: await this.loadTransfer(tx, access, header.id) };
    }, async (tx) => {
      const existing = await tx.stockTransfer.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } } });
      if (!existing) return null;
      if (existing.fromBranchId !== fromBranchId || existing.toBranchId !== dto.toBranchId) throw idempotencyReused();
      return { replayed: true, transfer: await this.loadTransfer(tx, access, existing.id) };
    });
  }

  /**
   * Correcting entry for an adjustment, opening balance or count: an equal and opposite
   * REVERSAL. Posted history is never edited. Each movement can be reversed once.
   */
  async reverse(access: EffectiveAccess, branchId: string, movementId: string, dto: ReverseMovementDto, meta: RequestMeta) {
    const key = `reversal:${movementId}`;
    return this.postOnce(access, key, async (tx) => {
      const original = await tx.stockMovement.findFirst({ where: { id: movementId, branchId } });
      if (!original) throw Errors.notFound('Stock movement');
      if (!['ADJUSTMENT', 'OPENING', 'COUNT'].includes(original.type)) {
        throw Errors.conflict('not_reversible', 'Receipts, transfers and returns are corrected through their own workflows');
      }
      await this.requireBranch(tx, branchId, { active: true });
      const [m] = await postMovements(tx, [{
        organizationId: access.organizationId, branchId, productId: original.productId, type: 'REVERSAL', quantityDelta: original.quantityDelta.negated(),
        reason: dto.reason.trim(), actorUserId: access.userId, idempotencyKey: key, reversesMovementId: original.id,
      }]);
      await this.audit.record(tx, {
        action: 'inventory.stock.reversed', resourceType: 'stock_movement', resourceId: m!.id, organizationId: access.organizationId, branchId,
        actorUserId: access.userId, metadata: { reversedMovementId: original.id, originalType: original.type, delta: m!.quantityDelta, reason: dto.reason.trim() },
      }, meta);
      return { replayed: false, movement: posted(m!, dto.reason.trim(), access.userId) };
    }, async (tx) => {
      const existing = await tx.stockMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } } });
      if (!existing) return null;
      return { replayed: true, movement: serializeMovement(access, existing) };
    });
  }

  // ---------------------------------------------------------------- internals

  /**
   * Runs `post` in a transaction; if the same posting already exists (found first, or a
   * concurrent duplicate won the race on the unique key), returns `replay` instead.
   */
  private async postOnce<T>(access: EffectiveAccess, _key: string, post: (tx: Tx) => Promise<T>, replay: (tx: Tx) => Promise<T | null>): Promise<T> {
    try {
      return await this.db.inOrg(access, async (tx) => {
        const again = await replay(tx);
        if (again) return again;
        await this.entitlements.assertWritable(tx, access.organizationId);
        return post(tx);
      });
    } catch (e) {
      if (!(e instanceof DuplicatePosting) && !(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const again = await this.db.inOrg(access, (tx) => replay(tx));
      if (again) return again;
      throw Errors.conflict('already_posted', 'This operation was already posted');
    }
  }

  private async loadCount(tx: Tx, access: EffectiveAccess, countId: string) {
    const c = await tx.stockCount.findUniqueOrThrow({ where: { id: countId }, include: { lines: { orderBy: { productId: 'asc' } } } });
    return {
      id: c.id, branchId: c.branchId, note: c.note, actorUserId: c.actorUserId, createdAt: c.createdAt,
      lines: c.lines.map((l) => ({
        productId: l.productId, expectedQuantity: fmtQty(l.expectedQuantity), countedQuantity: fmtQty(l.countedQuantity),
        difference: fmtQty(l.countedQuantity.minus(l.expectedQuantity)), movementId: l.movementId,
      })),
    };
  }

  private async loadTransfer(tx: Tx, access: EffectiveAccess, transferId: string) {
    const t = await tx.stockTransfer.findUniqueOrThrow({ where: { id: transferId } });
    const moves = await tx.stockMovement.findMany({ where: { sourceType: 'TRANSFER', sourceId: transferId }, orderBy: [{ productId: 'asc' }, { type: 'asc' }] });
    return {
      id: t.id, fromBranchId: t.fromBranchId, toBranchId: t.toBranchId, reason: t.reason, actorUserId: t.actorUserId, createdAt: t.createdAt,
      movements: moves.map((m) => serializeMovement(access, m)),
    };
  }

  private async requireProduct(tx: Tx, productId: string, opts: { allowInactive: boolean }) {
    const p = await tx.product.findUnique({ where: { id: productId }, select: { id: true, status: true, quantityScale: true } });
    if (!p || p.status === 'ARCHIVED' || (!opts.allowInactive && p.status !== 'ACTIVE')) throw Errors.notFound('Product');
    return p;
  }

  private async requireProducts(tx: Tx, ids: string[], opts: { allowInactive: boolean }) {
    const rows = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, quantityScale: true } });
    const map = new Map(rows.filter((p) => p.status !== 'ARCHIVED' && (opts.allowInactive || p.status === 'ACTIVE')).map((p) => [p.id, p]));
    for (const id of ids) if (!map.has(id)) throw Errors.notFound(`Product ${id}`);
    return map;
  }

  /** Archived branches keep their history readable but accept no new stock writes. */
  async requireBranch(tx: Tx, branchId: string, opts: { active?: boolean } = {}) {
    const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true, status: true } });
    if (!branch) throw Errors.notFound('Branch');
    if (opts.active && branch.status !== 'ACTIVE') throw Errors.conflict('branch_archived', 'This branch is archived and accepts no new transactions');
  }
}

const QUANTITY_OK = (s: string) => /^-?\d{1,15}(\.\d{1,3})?$/.test(s);

function posted(m: PostedMovement, reason: string, actorUserId: string) {
  return { id: m.id, branchId: m.branchId, productId: m.productId, type: m.type, quantityDelta: m.quantityDelta, balanceAfter: m.balanceAfter, reason, actorUserId, createdAt: m.createdAt };
}

export function serializeMovement(access: EffectiveAccess, m: MovementRow) {
  return {
    id: m.id, branchId: m.branchId, productId: m.productId, type: m.type,
    quantityDelta: m.quantityDelta.toFixed(3), balanceAfter: m.balanceAfter.toFixed(3),
    reason: m.reason, actorUserId: m.actorUserId, createdAt: m.createdAt, sourceType: m.sourceType, sourceId: m.sourceId,
    reversesMovementId: m.reversesMovementId,
    ...(can(access, 'inventory.cost.read') ? { unitCostMinor: fmtMinor(m.unitCostMinor) } : {}),
  };
}
