import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { ApiError, Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { branchesWith, can, type EffectiveAccess } from '../authz/permission-evaluator';
import type { PermissionKey } from '../authz/permission-registry';
import { Prisma } from '../generated/prisma/client';
import { EntitlementService } from '../subscriptions/entitlement.service';
import type {
  CreatePurchaseOrderDto, GoodsReceiptDto, ListPurchaseOrdersQuery, PurchaseOrderLineDto, PurchasingReportQuery, ReasonedVersionDto, SupplierReturnDto,
  UpdatePurchaseOrderDto,
} from '../inventory/dto/inventory.dto';
import { DuplicatePosting, idempotencyReused, postMovements, requireIdempotencyKey } from '../inventory/ledger';
import { fmtMinor, fmtQty, lineTotalMinor, parseMinor, parseQuantity } from '../inventory/quantity';

type Status = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ISSUED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
type PoWithLines = Prisma.PurchaseOrderGetPayload<{ include: { lines: { include: { product: { select: { id: true; sku: true; name: true; unit: true } } } }; supplier: { select: { id: true; code: true; name: true } } } }>;

interface Locked { id: string; status: Status; version: number; branch_id: string; supplier_id: string; created_by_user_id: string; submitted_by_user_id: string | null; number: string }

const PO_INCLUDE = {
  lines: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } }, orderBy: { lineNo: 'asc' as const } },
  supplier: { select: { id: true, code: true, name: true } },
} as const;

const versionConflict = (current: number) => Errors.conflict('version_conflict', `The purchase order changed (current version ${current}); reload and retry`);
const wrongStatus = (status: string, action: string) => Errors.conflict('invalid_status', `A ${status} purchase order cannot be ${action}`);

/**
 * Purchase orders (docs/architecture/11-inventory-purchasing.md §5).
 *
 *   DRAFT ─submit→ SUBMITTED ─approve→ APPROVED ─issue→ ISSUED ─receive→ PARTIALLY_RECEIVED ─→ RECEIVED
 *     ↑              │reject                                   │                     │close
 *     └──edit── REJECTED                                cancel (nothing received)   CLOSED
 *
 * Every transition locks the order row, checks the caller's version, re-checks permissions at
 * the order's branch, and writes the status change, an event and an audit record in one
 * transaction. Totals are computed on the server and checked by the database. Receipts post
 * stock through the ledger in the same transaction and are idempotent per Idempotency-Key.
 */
@Injectable()
export class PurchasingService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
  ) {}

  // ---------------------------------------------------------------- reads

  list(access: EffectiveAccess, q: ListPurchaseOrdersQuery) {
    const limit = q.limit ?? 50;
    const cursor = decodeCursor(q.cursor);
    const branches = branchesWith(access, 'purchasing.order.read');
    if (branches !== 'ALL' && branches.length === 0) return { items: [], nextCursor: null };
    if (q.branchId && branches !== 'ALL' && !branches.includes(q.branchId)) return { items: [], nextCursor: null };
    return this.db.inOrg(access, async (tx) => {
      const rows = await tx.purchaseOrder.findMany({
        where: {
          AND: [
            branches === 'ALL' ? {} : { branchId: { in: branches } },
            q.branchId ? { branchId: q.branchId } : {}, q.status ? { status: q.status as Status } : {}, q.supplierId ? { supplierId: q.supplierId } : {},
            cursor ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {},
          ],
        },
        include: { supplier: { select: { id: true, code: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((po) => ({
          id: po.id, number: po.number, status: po.status, supplier: po.supplier, branchId: po.branchId, currency: po.currency,
          ...(this.seesCosts(access, po.branchId) ? { subtotalMinor: fmtMinor(po.subtotalMinor) } : {}),
          expectedDate: po.expectedDate, version: po.version, createdAt: po.createdAt,
        })),
        nextCursor: rows.length > limit ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
      };
    });
  }

  get(access: EffectiveAccess, id: string) {
    return this.db.inOrg(access, async (tx) => this.view(access, await this.loadVisible(tx, access, id, 'purchasing.order.read')));
  }

  events(access: EffectiveAccess, id: string) {
    return this.db.inOrg(access, async (tx) => {
      await this.loadVisible(tx, access, id, 'purchasing.order.read');
      const rows = await tx.purchaseOrderEvent.findMany({ where: { purchaseOrderId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      return { items: rows.map((e) => ({ id: e.id, type: e.type, fromStatus: e.fromStatus, toStatus: e.toStatus, actorUserId: e.actorUserId, reason: e.reason, data: e.data, createdAt: e.createdAt })) };
    });
  }

  receipts(access: EffectiveAccess, id: string) {
    return this.db.inOrg(access, async (tx) => {
      await this.loadVisible(tx, access, id, 'purchasing.order.read');
      const [receipts, returns] = await Promise.all([
        tx.goodsReceipt.findMany({ where: { purchaseOrderId: id }, include: { lines: true }, orderBy: { createdAt: 'asc' } }),
        tx.supplierReturn.findMany({ where: { purchaseOrderId: id }, include: { lines: true }, orderBy: { createdAt: 'asc' } }),
      ]);
      return {
        receipts: receipts.map((r) => ({ id: r.id, note: r.note, actorUserId: r.actorUserId, createdAt: r.createdAt, lines: r.lines.map((l) => ({ lineId: l.lineId, quantity: fmtQty(l.quantity), movementId: l.movementId })) })),
        returns: returns.map((r) => ({ id: r.id, type: r.type, reason: r.reason, actorUserId: r.actorUserId, createdAt: r.createdAt, lines: r.lines.map((l) => ({ lineId: l.lineId, quantity: fmtQty(l.quantity), movementId: l.movementId })) })),
      };
    });
  }

  /** purchasing.report.read: order counts and values by status and supplier, optionally within a creation period. */
  report(access: EffectiveAccess, q: PurchasingReportQuery) {
    const createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(new Date(q.to).getTime() + 86_400_000) } : {}) };
    const where = Object.keys(createdAt).length ? { createdAt } : {};
    return this.db.inOrg(access, async (tx) => {
      const byStatus = await tx.purchaseOrder.groupBy({ by: ['status', 'currency'], where, _count: { _all: true }, _sum: { subtotalMinor: true } });
      const bySupplier = await tx.purchaseOrder.groupBy({
        by: ['supplierId', 'currency'], where: { ...where, status: { notIn: ['CANCELLED', 'DRAFT', 'REJECTED'] } }, _count: { _all: true }, _sum: { subtotalMinor: true },
      });
      const suppliers = await tx.supplier.findMany({ where: { id: { in: bySupplier.map((r) => r.supplierId) } }, select: { id: true, code: true, name: true } });
      const names = new Map(suppliers.map((s) => [s.id, s]));
      return {
        period: { from: q.from ?? null, to: q.to ?? null },
        byStatus: byStatus.map((r) => ({ status: r.status, currency: r.currency, orders: r._count._all, valueMinor: fmtMinor(r._sum.subtotalMinor ?? 0n) })),
        bySupplier: bySupplier.map((r) => ({ supplier: names.get(r.supplierId) ?? { id: r.supplierId }, currency: r.currency, orders: r._count._all, valueMinor: fmtMinor(r._sum.subtotalMinor ?? 0n) })),
      };
    });
  }

  // ---------------------------------------------------------------- drafting

  create(access: EffectiveAccess, branchId: string, dto: CreatePurchaseOrderDto, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertWritable(tx, access.organizationId);
      const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { status: true } });
      if (!branch) throw Errors.notFound('Branch');
      if (branch.status !== 'ACTIVE') throw Errors.conflict('branch_archived', 'This branch is archived and accepts no new transactions');
      const supplier = await this.activeSupplier(tx, dto.supplierId);
      const lines = await this.buildLines(tx, dto.lines);
      const [{ last_value: n }] = await tx.$queryRaw<{ last_value: number }[]>`
        INSERT INTO organization_sequences (organization_id, name, last_value) VALUES (${access.organizationId}::uuid, 'purchase_order', 1)
        ON CONFLICT (organization_id, name) DO UPDATE SET last_value = organization_sequences.last_value + 1
        RETURNING last_value`;
      const po = await tx.purchaseOrder.create({
        data: {
          organizationId: access.organizationId, number: `PO-${String(n).padStart(6, '0')}`, supplierId: supplier.id, branchId, currency: supplier.currency,
          notes: dto.notes?.trim() || null, expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null, createdByUserId: access.userId,
        },
      });
      await tx.purchaseOrderLine.createMany({ data: lines.map((l, i) => ({ organizationId: access.organizationId, purchaseOrderId: po.id, lineNo: i + 1, ...l })) });
      await this.event(tx, access, po.id, 'CREATED', null, 'DRAFT', null, { lines: lines.length });
      await this.audit.record(tx, {
        action: 'purchasing.order.created', resourceType: 'purchase_order', resourceId: po.id, organizationId: access.organizationId, branchId,
        actorUserId: access.userId, after: { number: po.number, supplierId: supplier.id, lines: lines.length },
      }, meta);
      return this.view(access, await tx.purchaseOrder.findUniqueOrThrow({ where: { id: po.id }, include: PO_INCLUDE }));
    });
  }

  /** Drafts (and rejected orders, which return to DRAFT) can change supplier, lines, notes and date. */
  update(access: EffectiveAccess, id: string, dto: UpdatePurchaseOrderDto, meta: RequestMeta) {
    return this.transition(access, id, dto.version, 'purchasing.order.create', async (tx, po) => {
      if (po.status !== 'DRAFT' && po.status !== 'REJECTED') throw wrongStatus(po.status, 'edited');
      const data: Prisma.PurchaseOrderUpdateInput = {};
      if (dto.supplierId && dto.supplierId !== po.supplier_id) {
        const supplier = await this.activeSupplier(tx, dto.supplierId);
        data.supplier = { connect: { id_organizationId: { id: supplier.id, organizationId: access.organizationId } } };
        data.currency = supplier.currency;
      }
      if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
      if (dto.expectedDate !== undefined) data.expectedDate = dto.expectedDate ? new Date(dto.expectedDate) : null;
      if (po.status === 'REJECTED') { data.status = 'DRAFT'; data.rejectionReason = null; data.decidedByUserId = null; data.decidedAt = null; }
      if (dto.lines) {
        const lines = await this.buildLines(tx, dto.lines);
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderLine.createMany({ data: lines.map((l, i) => ({ organizationId: access.organizationId, purchaseOrderId: id, lineNo: i + 1, ...l })) });
      }
      // Any edit is a new version, including a line-only edit (the database sets OLD + 1).
      await tx.purchaseOrder.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      return { event: po.status === 'REJECTED' ? 'REVISED' : 'EDITED', to: po.status === 'REJECTED' ? 'DRAFT' : null, audit: 'purchasing.order.updated', data: { linesReplaced: !!dto.lines } };
    }, meta);
  }

  submit(access: EffectiveAccess, id: string, version: number, meta: RequestMeta) {
    return this.transition(access, id, version, 'purchasing.order.submit', async (tx, po) => {
      if (po.status !== 'DRAFT') throw wrongStatus(po.status, 'submitted');
      if (!(await tx.purchaseOrderLine.count({ where: { purchaseOrderId: id } }))) throw Errors.badRequest('no_lines', 'Add at least one line');
      await this.assertSupplierActive(tx, po.supplier_id);
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'SUBMITTED', submittedByUserId: access.userId, submittedAt: new Date() } });
      return { event: 'SUBMITTED', to: 'SUBMITTED', audit: 'purchasing.order.submitted' };
    }, meta);
  }

  /**
   * Separation of duties: the approver must be neither the creator nor the submitter, unless
   * they hold purchasing.order.self_approve at that branch (recorded and audited). The
   * database refuses an approval by the submitter without the self-approval flag.
   */
  approve(access: EffectiveAccess, id: string, version: number, meta: RequestMeta) {
    return this.transition(access, id, version, 'purchasing.order.approve', async (tx, po) => {
      if (po.status !== 'SUBMITTED') throw wrongStatus(po.status, 'approved');
      const own = po.submitted_by_user_id === access.userId || po.created_by_user_id === access.userId;
      if (own && !can(access, 'purchasing.order.self_approve', po.branch_id)) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'separation_of_duties', 'You cannot approve a purchase order you created or submitted');
      }
      await this.assertSupplierActive(tx, po.supplier_id);
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'APPROVED', decidedByUserId: access.userId, decidedAt: new Date(), selfApproved: own } });
      return { event: 'APPROVED', to: 'APPROVED', audit: 'purchasing.order.approved', data: { selfApproved: own } };
    }, meta);
  }

  reject(access: EffectiveAccess, id: string, dto: ReasonedVersionDto, meta: RequestMeta) {
    return this.transition(access, id, dto.version, 'purchasing.order.approve', async (tx, po) => {
      if (po.status !== 'SUBMITTED') throw wrongStatus(po.status, 'rejected');
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'REJECTED', decidedByUserId: access.userId, decidedAt: new Date(), rejectionReason: dto.reason.trim() } });
      return { event: 'REJECTED', to: 'REJECTED', audit: 'purchasing.order.rejected', reason: dto.reason.trim() };
    }, meta);
  }

  /** Sends (confirms) an approved order to the supplier. Only issued orders can be received. */
  issue(access: EffectiveAccess, id: string, version: number, meta: RequestMeta) {
    return this.transition(access, id, version, 'purchasing.order.create', async (tx, po) => {
      if (po.status !== 'APPROVED') throw wrongStatus(po.status, 'issued');
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'ISSUED', issuedAt: new Date() } });
      return { event: 'ISSUED', to: 'ISSUED', audit: 'purchasing.order.issued' };
    }, meta);
  }

  /**
   * Cancels an order nothing has been received against. Drafts and rejected orders: whoever can
   * edit them; submitted, approved or issued orders: an approver. History is kept.
   */
  cancel(access: EffectiveAccess, id: string, dto: ReasonedVersionDto, meta: RequestMeta) {
    return this.transition(access, id, dto.version, 'purchasing.order.read', async (tx, po) => {
      const editable = po.status === 'DRAFT' || po.status === 'REJECTED';
      if (po.status === 'PARTIALLY_RECEIVED' || po.status === 'RECEIVED') {
        throw Errors.conflict('goods_received', 'Goods were received against this order; close it instead');
      }
      if (!editable && !['SUBMITTED', 'APPROVED', 'ISSUED'].includes(po.status)) throw wrongStatus(po.status, 'cancelled');
      const needed: PermissionKey = editable ? 'purchasing.order.create' : 'purchasing.order.approve';
      if (!can(access, needed, po.branch_id)) throw Errors.forbidden();
      if (await tx.purchaseOrderLine.count({ where: { purchaseOrderId: id, quantityReceived: { gt: 0 } } })) {
        throw Errors.conflict('goods_received', 'Goods were received against this order; close it instead');
      }
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED', closeReason: dto.reason.trim(), closedAt: new Date() } });
      return { event: 'CANCELLED', to: 'CANCELLED', audit: 'purchasing.order.cancelled', reason: dto.reason.trim() };
    }, meta);
  }

  /** Short-closes a partially received order: the remainder will not be delivered. */
  close(access: EffectiveAccess, id: string, dto: ReasonedVersionDto, meta: RequestMeta) {
    return this.transition(access, id, dto.version, 'purchasing.order.approve', async (tx, po) => {
      if (po.status !== 'PARTIALLY_RECEIVED') throw wrongStatus(po.status, 'closed');
      await tx.purchaseOrder.update({ where: { id }, data: { status: 'CLOSED', closeReason: dto.reason.trim(), closedAt: new Date() } });
      return { event: 'CLOSED', to: 'CLOSED', audit: 'purchasing.order.closed', reason: dto.reason.trim() };
    }, meta);
  }

  // ---------------------------------------------------------------- receiving

  /**
   * Posts a goods receipt: stock in at the order's branch through the ledger, received
   * quantities and status updated, all in one transaction. Cumulative receipts can never
   * exceed the ordered quantity (no over-receipt policy exists; the database checks it too).
   * Idempotent: the same Idempotency-Key returns the original receipt.
   */
  async receive(access: EffectiveAccess, id: string, dto: GoodsReceiptDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    if (new Set(dto.lines.map((l) => l.lineId)).size !== dto.lines.length) throw Errors.badRequest('duplicate_lines', 'Each order line may appear once per receipt');
    return this.once(access, async (tx) => {
      const replay = await this.receiptReplay(tx, access, key, id, dto);
      if (replay) return replay;
      const po = await this.lock(tx, access, id, 'purchasing.order.receive');
      if (po.status !== 'ISSUED' && po.status !== 'PARTIALLY_RECEIVED') throw wrongStatus(po.status, 'received');
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id }, include: { product: { select: { quantityScale: true } } } });
      const byId = new Map(lines.map((l) => [l.id, l]));
      const qty = dto.lines.map((l) => {
        const line = byId.get(l.lineId);
        if (!line) throw Errors.notFound(`Order line ${l.lineId}`);
        const q = parseQuantity(l.quantity, line.product.quantityScale, 'positive');
        const open = line.quantityOrdered.minus(line.quantityReceived);
        if (q.greaterThan(open)) throw Errors.conflict('over_receipt', `Line ${line.lineNo}: only ${fmtQty(open)} remain to be received`);
        return q;
      });
      const receipt = await tx.goodsReceipt.create({
        data: { organizationId: access.organizationId, purchaseOrderId: id, branchId: po.branch_id, idempotencyKey: key, note: dto.note?.trim() || null, actorUserId: access.userId },
      });
      const moves = await postMovements(tx, dto.lines.map((l, i) => ({
        organizationId: access.organizationId, branchId: po.branch_id, productId: byId.get(l.lineId)!.productId, type: 'RECEIPT' as const, quantityDelta: qty[i],
        reason: `Goods receipt ${po.number}`, actorUserId: access.userId, idempotencyKey: `receipt:${receipt.id}:${l.lineId}`,
        sourceType: 'GOODS_RECEIPT' as const, sourceId: receipt.id, unitCostMinor: byId.get(l.lineId)!.unitCostMinor,
      })));
      await tx.goodsReceiptLine.createMany({ data: dto.lines.map((l, i) => ({ organizationId: access.organizationId, receiptId: receipt.id, lineId: l.lineId, quantity: qty[i], movementId: moves[i]!.id })) });
      for (const [i, l] of dto.lines.entries()) await tx.purchaseOrderLine.update({ where: { id: l.lineId }, data: { quantityReceived: { increment: qty[i] } } });
      const status = await this.receivingStatus(tx, id);
      await tx.purchaseOrder.update({ where: { id }, data: { status } });
      await this.event(tx, access, id, 'GOODS_RECEIVED', po.status, status, null, { receiptId: receipt.id, lines: dto.lines.length });
      await this.audit.record(tx, {
        action: 'purchasing.order.received', resourceType: 'goods_receipt', resourceId: receipt.id, organizationId: access.organizationId, branchId: po.branch_id,
        actorUserId: access.userId, metadata: { purchaseOrderId: id, lines: dto.lines.map((l, i) => ({ lineId: l.lineId, quantity: qty[i].toFixed(3) })), status },
      }, meta);
      return { replayed: false, receiptId: receipt.id, order: this.view(access, await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: PO_INCLUDE })) };
    }, (tx) => this.receiptReplay(tx, access, key, id, dto));
  }

  /**
   * RETURN: goods sent back (received stays, returned grows; stock out).
   * RECEIPT_CORRECTION: a receipt recorded too much (received shrinks, so the order can be
   * received again; stock out). Both post through the ledger and need stock on hand.
   */
  async returnGoods(access: EffectiveAccess, id: string, dto: SupplierReturnDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    if (new Set(dto.lines.map((l) => l.lineId)).size !== dto.lines.length) throw Errors.badRequest('duplicate_lines', 'Each order line may appear once');
    const replayOf = async (tx: Tx) => {
      const existing = await tx.supplierReturn.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } }, include: { lines: true } });
      if (!existing) return null;
      if (existing.purchaseOrderId !== id || existing.type !== dto.type) throw idempotencyReused();
      return { replayed: true, returnId: existing.id, order: this.view(access, await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: PO_INCLUDE })) };
    };
    return this.once(access, async (tx) => {
      const replay = await replayOf(tx);
      if (replay) return replay;
      const po = await this.lock(tx, access, id, 'purchasing.return.create');
      if (!['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'].includes(po.status)) throw wrongStatus(po.status, 'returned against');
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id }, include: { product: { select: { quantityScale: true } } } });
      const byId = new Map(lines.map((l) => [l.id, l]));
      const qty = dto.lines.map((l) => {
        const line = byId.get(l.lineId);
        if (!line) throw Errors.notFound(`Order line ${l.lineId}`);
        const q = parseQuantity(l.quantity, line.product.quantityScale, 'positive');
        const available = line.quantityReceived.minus(line.quantityReturned);
        if (q.greaterThan(available)) throw Errors.conflict('exceeds_received', `Line ${line.lineNo}: only ${fmtQty(available)} received and not yet returned`);
        return q;
      });
      const ret = await tx.supplierReturn.create({
        data: { organizationId: access.organizationId, purchaseOrderId: id, branchId: po.branch_id, type: dto.type, idempotencyKey: key, reason: dto.reason.trim(), actorUserId: access.userId },
      });
      const moves = await postMovements(tx, dto.lines.map((l, i) => ({
        organizationId: access.organizationId, branchId: po.branch_id, productId: byId.get(l.lineId)!.productId,
        type: dto.type === 'RETURN' ? 'RETURN_TO_SUPPLIER' as const : 'RECEIPT_CORRECTION' as const, quantityDelta: qty[i].negated(),
        reason: dto.reason.trim(), actorUserId: access.userId, idempotencyKey: `return:${ret.id}:${l.lineId}`, sourceType: 'SUPPLIER_RETURN' as const, sourceId: ret.id,
        unitCostMinor: byId.get(l.lineId)!.unitCostMinor,
      })));
      await tx.supplierReturnLine.createMany({ data: dto.lines.map((l, i) => ({ organizationId: access.organizationId, returnId: ret.id, lineId: l.lineId, quantity: qty[i], movementId: moves[i]!.id })) });
      for (const [i, l] of dto.lines.entries()) {
        await tx.purchaseOrderLine.update({
          where: { id: l.lineId }, data: dto.type === 'RETURN' ? { quantityReturned: { increment: qty[i] } } : { quantityReceived: { decrement: qty[i] } },
        });
      }
      let status = po.status;
      if (dto.type === 'RECEIPT_CORRECTION' && po.status !== 'CLOSED') {
        status = await this.receivingStatus(tx, id);
        await tx.purchaseOrder.update({ where: { id }, data: { status } });
      } else {
        await tx.purchaseOrder.update({ where: { id }, data: { updatedAt: new Date() } });
      }
      await this.event(tx, access, id, dto.type === 'RETURN' ? 'GOODS_RETURNED' : 'RECEIPT_CORRECTED', po.status, status, dto.reason.trim(), { returnId: ret.id });
      await this.audit.record(tx, {
        action: dto.type === 'RETURN' ? 'purchasing.order.goods_returned' : 'purchasing.order.receipt_corrected', resourceType: 'supplier_return', resourceId: ret.id,
        organizationId: access.organizationId, branchId: po.branch_id, actorUserId: access.userId,
        metadata: { purchaseOrderId: id, reason: dto.reason.trim(), lines: dto.lines.map((l, i) => ({ lineId: l.lineId, quantity: qty[i].toFixed(3) })) },
      }, meta);
      return { replayed: false, returnId: ret.id, order: this.view(access, await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: PO_INCLUDE })) };
    }, replayOf);
  }

  // ---------------------------------------------------------------- internals

  private async receiptReplay(tx: Tx, access: EffectiveAccess, key: string, id: string, dto: GoodsReceiptDto) {
    const existing = await tx.goodsReceipt.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } }, include: { lines: true } });
    if (!existing) return null;
    const same = existing.purchaseOrderId === id && existing.lines.length === dto.lines.length
      && dto.lines.every((l) => existing.lines.some((x) => x.lineId === l.lineId && /^\d{1,15}(\.\d{1,3})?$/.test(l.quantity) && x.quantity.equals(l.quantity)));
    if (!same) throw idempotencyReused();
    return { replayed: true, receiptId: existing.id, order: this.view(access, await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: PO_INCLUDE })) };
  }

  /** Runs a posting; a concurrent duplicate that won on the unique key is returned as a replay. */
  private async once<T>(access: EffectiveAccess, post: (tx: Tx) => Promise<T>, replay: (tx: Tx) => Promise<T | null>): Promise<T> {
    try {
      return await this.db.inOrg(access, async (tx) => {
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

  private async receivingStatus(tx: Tx, id: string): Promise<Status> {
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id }, select: { quantityOrdered: true, quantityReceived: true } });
    if (lines.every((l) => l.quantityReceived.equals(l.quantityOrdered))) return 'RECEIVED';
    return lines.some((l) => l.quantityReceived.greaterThan(0)) ? 'PARTIALLY_RECEIVED' : 'ISSUED';
  }

  /**
   * Common transition wrapper: lock, version check, permission at the order's branch,
   * then `apply`, an event and an audit record, in one transaction.
   */
  private async transition(
    access: EffectiveAccess, id: string, version: number, permission: PermissionKey,
    apply: (tx: Tx, po: Locked) => Promise<{ event: string; to: Status | null; audit: string; reason?: string; data?: Record<string, unknown> }>,
    meta: RequestMeta,
  ) {
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertWritable(tx, access.organizationId);
      const po = await this.lock(tx, access, id, permission);
      if (po.version !== version) throw versionConflict(po.version);
      const r = await apply(tx, po);
      await this.event(tx, access, id, r.event, po.status, r.to, r.reason ?? null, r.data ?? {});
      await this.audit.record(tx, {
        action: r.audit, resourceType: 'purchase_order', resourceId: id, organizationId: access.organizationId, branchId: po.branch_id, actorUserId: access.userId,
        before: { status: po.status, version: po.version }, after: { status: r.to ?? po.status }, metadata: { number: po.number, reason: r.reason ?? null, ...(r.data ?? {}) },
      }, meta);
      return this.view(access, await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: PO_INCLUDE }));
    });
  }

  /**
   * Locks the order. Not found (404) unless the caller may see orders at its branch
   * (read, or the permission for this action); then the action permission is required (403).
   */
  private async lock(tx: Tx, access: EffectiveAccess, id: string, permission: PermissionKey): Promise<Locked> {
    const [po] = await tx.$queryRaw<Locked[]>`
      SELECT id, status::text AS status, version, branch_id, supplier_id, created_by_user_id, submitted_by_user_id, number
      FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (!po || !(can(access, 'purchasing.order.read', po.branch_id) || can(access, permission, po.branch_id))) throw Errors.notFound('Purchase order');
    if (!can(access, permission, po.branch_id)) throw Errors.forbidden();
    return po;
  }

  private async loadVisible(tx: Tx, access: EffectiveAccess, id: string, permission: PermissionKey): Promise<PoWithLines> {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, include: PO_INCLUDE });
    if (!po || !can(access, permission, po.branchId)) throw Errors.notFound('Purchase order');
    return po;
  }

  private async activeSupplier(tx: Tx, supplierId: string) {
    const s = await tx.supplier.findUnique({ where: { id: supplierId }, select: { id: true, status: true, currency: true } });
    if (!s) throw Errors.notFound('Supplier');
    if (s.status !== 'ACTIVE') throw Errors.conflict('supplier_inactive', 'The supplier is inactive');
    return s;
  }

  private async assertSupplierActive(tx: Tx, supplierId: string) {
    await this.activeSupplier(tx, supplierId);
  }

  /** Validates lines and computes totals server-side (the client never sends totals). */
  private async buildLines(tx: Tx, input: PurchaseOrderLineDto[]) {
    if (new Set(input.map((l) => l.productId)).size !== input.length) throw Errors.badRequest('duplicate_lines', 'Each product may appear once per order');
    const products = await tx.product.findMany({ where: { id: { in: input.map((l) => l.productId) } }, select: { id: true, status: true, quantityScale: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    return input.map((l) => {
      const p = byId.get(l.productId);
      if (!p || p.status !== 'ACTIVE') throw Errors.notFound(`Product ${l.productId}`);
      const quantityOrdered = parseQuantity(l.quantity, p.quantityScale, 'positive');
      const unitCostMinor = parseMinor(l.unitCostMinor, 'unitCostMinor')!;
      return { productId: p.id, quantityOrdered, unitCostMinor, lineTotalMinor: lineTotalMinor(quantityOrdered, unitCostMinor) };
    });
  }

  private event(tx: Tx, access: EffectiveAccess, id: string, type: string, from: string | null, to: string | null, reason: string | null, data: Record<string, unknown>) {
    return tx.purchaseOrderEvent.createMany({
      data: [{ organizationId: access.organizationId, purchaseOrderId: id, type, fromStatus: from, toStatus: to, actorUserId: access.userId, reason, data: data as Prisma.InputJsonValue }],
    });
  }

  /** Costs for holders of inventory.cost.read, or those who create, submit or approve orders at this branch. */
  private seesCosts(access: EffectiveAccess, branchId: string) {
    return can(access, 'inventory.cost.read') || can(access, 'purchasing.order.create', branchId) || can(access, 'purchasing.order.submit', branchId)
      || can(access, 'purchasing.order.approve', branchId);
  }

  private view(access: EffectiveAccess, po: PoWithLines) {
    const costs = this.seesCosts(access, po.branchId);
    return {
      id: po.id, number: po.number, status: po.status, supplier: po.supplier, branchId: po.branchId, currency: po.currency,
      ...(costs ? { subtotalMinor: fmtMinor(po.subtotalMinor) } : {}),
      notes: po.notes, expectedDate: po.expectedDate, version: po.version,
      createdByUserId: po.createdByUserId, submittedByUserId: po.submittedByUserId, submittedAt: po.submittedAt,
      decidedByUserId: po.decidedByUserId, decidedAt: po.decidedAt, selfApproved: po.selfApproved, rejectionReason: po.rejectionReason,
      issuedAt: po.issuedAt, closedAt: po.closedAt, closeReason: po.closeReason, createdAt: po.createdAt, updatedAt: po.updatedAt,
      lines: po.lines.map((l) => ({
        id: l.id, lineNo: l.lineNo, product: l.product, quantityOrdered: fmtQty(l.quantityOrdered), quantityReceived: fmtQty(l.quantityReceived),
        quantityReturned: fmtQty(l.quantityReturned), quantityOutstanding: fmtQty(l.quantityOrdered.minus(l.quantityReceived)),
        ...(costs ? { unitCostMinor: fmtMinor(l.unitCostMinor), lineTotalMinor: fmtMinor(l.lineTotalMinor) } : {}),
      })),
    };
  }
}
