import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { branchesWith, can, type EffectiveAccess } from '../authz/permission-evaluator';
import type { PermissionKey } from '../authz/permission-registry';
import { Prisma } from '../generated/prisma/client';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { DuplicatePosting, idempotencyReused, postMovements, requireIdempotencyKey } from '../inventory/ledger';
import { sessionExpectedCash } from './session-cash';
import { fmtMinor, fmtQty, lineTotalMinor, parseMinor, parseQuantity } from '../inventory/quantity';
import { CustomersService } from './customers.service';
import type {
  AcceptReturnDto, CloseSessionDto, CreateSaleDto, FailPaymentDto, ListSalesQuery, OpenSessionDto, RecordPaymentDto, RefundDto, SalesReportQuery,
} from './dto/sales.dto';

type SaleFull = Prisma.SaleGetPayload<{ include: typeof SALE_INCLUDE }>;

const SALE_INCLUDE = {
  lines: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } }, orderBy: { lineNo: 'asc' as const } },
  payments: { orderBy: { createdAt: 'asc' as const } },
  refunds: { orderBy: { createdAt: 'asc' as const } },
  returns: { include: { lines: true }, orderBy: { createdAt: 'asc' as const } },
} as const;

const versionConflict = (current: number) => Errors.conflict('version_conflict', `The record changed (current version ${current}); reload and retry`);
/** 13-19 consecutive digits look like a card number: never stored. */
const CARD_LIKE = /[0-9]{13,19}/;

/**
 * Point of sale (docs/architecture/12-sales.md).
 *
 * Sales are posted complete in one transaction: receipt number, sale, SALE stock movements
 * (through the Phase 4 ledger trigger, which locks balances and refuses negative stock) and
 * lines (each linked to its movement). Any failure rolls everything back; the database also
 * verifies the total at commit. Payments, refunds and returns are separate, explicit,
 * idempotent operations, serialized by row locks on the sale or payment they affect.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
    private readonly customers: CustomersService,
  ) {}

  // ---------------------------------------------------------------- cashier sessions

  async openSession(access: EffectiveAccess, branchId: string, dto: OpenSessionDto, meta: RequestMeta) {
    const float = parseMinor(dto.openingFloatMinor, 'openingFloatMinor')!;
    try {
      return await this.db.inOrg(access, async (tx) => {
        await this.entitlements.assertWritable(tx, access.organizationId);
        await this.activeBranch(tx, branchId);
        const org = await tx.organization.findUniqueOrThrow({ where: { id: access.organizationId }, select: { defaultCurrency: true } });
        const s = await tx.cashierSession.create({
          data: { organizationId: access.organizationId, branchId, cashierUserId: access.userId, currency: org.defaultCurrency, openingFloatMinor: float },
        });
        await this.audit.record(tx, {
          action: 'sales.session.opened', resourceType: 'cashier_session', resourceId: s.id, organizationId: access.organizationId, branchId,
          actorUserId: access.userId, metadata: { openingFloatMinor: float.toString() },
        }, meta);
        return sessionView(s);
      });
    } catch (e) {
      // The partial unique index allows one OPEN session per cashier and branch, also under concurrency.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.conflict('session_already_open', 'You already have an open cashier session at this branch');
      }
      throw e;
    }
  }

  listSessions(access: EffectiveAccess, branchId: string, status?: 'OPEN' | 'CLOSED') {
    const all = can(access, 'sales.session.supervise', branchId);
    if (!all && !can(access, 'sales.session.manage', branchId)) throw Errors.forbidden();
    return this.db.inOrg(access, async (tx) => {
      if (!(await tx.branch.findUnique({ where: { id: branchId }, select: { id: true } }))) throw Errors.notFound('Branch');
      const rows = await tx.cashierSession.findMany({
        where: { branchId, ...(status ? { status } : {}), ...(all ? {} : { cashierUserId: access.userId }) },
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }], take: 200,
      });
      return { items: rows.map(sessionView) };
    });
  }

  getSession(access: EffectiveAccess, sessionId: string) {
    return this.db.inOrg(access, async (tx) => {
      const s = await tx.cashierSession.findUnique({ where: { id: sessionId } });
      if (!s || !this.mayAccessSession(access, s)) throw Errors.notFound('Cashier session');
      return { ...sessionView(s), expectedCashSoFarMinor: (await this.expectedCash(tx, s.id, s.openingFloatMinor)).toString() };
    });
  }

  /** Closes a session: expected cash is computed from the ledger of payments and refunds; the variance is stored. */
  closeSession(access: EffectiveAccess, sessionId: string, dto: CloseSessionDto, meta: RequestMeta) {
    const declared = parseMinor(dto.declaredCashMinor, 'declaredCashMinor')!;
    return this.db.inOrg(access, async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cashier_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      if (!locked) throw Errors.notFound('Cashier session');
      const s = await tx.cashierSession.findUniqueOrThrow({ where: { id: sessionId } });
      if (!this.mayAccessSession(access, s)) throw Errors.notFound('Cashier session');
      if (s.cashierUserId !== access.userId && !can(access, 'sales.session.supervise', s.branchId)) throw Errors.forbidden();
      if (s.status !== 'OPEN') throw Errors.conflict('session_closed', 'This session is already closed');
      if (s.version !== dto.version) throw versionConflict(s.version);
      const expected = await this.expectedCash(tx, s.id, s.openingFloatMinor);
      const closed = await tx.cashierSession.update({
        where: { id: sessionId },
        data: {
          status: 'CLOSED', closedAt: new Date(), closedByUserId: access.userId, expectedCashMinor: expected, declaredCashMinor: declared,
          varianceMinor: declared - expected, closeNote: dto.note?.trim() || null,
        },
      });
      await this.audit.record(tx, {
        action: 'sales.session.closed', resourceType: 'cashier_session', resourceId: s.id, organizationId: access.organizationId, branchId: s.branchId,
        actorUserId: access.userId,
        metadata: { cashierUserId: s.cashierUserId, closedBySupervisor: s.cashierUserId !== access.userId, expectedCashMinor: expected.toString(), declaredCashMinor: declared.toString(), varianceMinor: (declared - expected).toString() },
      }, meta);
      return sessionView(closed);
    });
  }

  private mayAccessSession(access: EffectiveAccess, s: { cashierUserId: string; branchId: string }) {
    return can(access, 'sales.session.supervise', s.branchId) || (s.cashierUserId === access.userId && can(access, 'sales.session.manage', s.branchId));
  }

  /** See session-cash.ts: the one definition of a drawer's expected cash. */
  private expectedCash(tx: Tx, sessionId: string, float: bigint): Promise<bigint> {
    return sessionExpectedCash(tx, sessionId, float);
  }

  // ---------------------------------------------------------------- sales

  /**
   * Posts a sale. Requires the caller's own open session at the branch. Prices are the
   * products' current selling prices (server-side). Idempotency-Key makes retries and
   * concurrent duplicates post once; insufficient stock rolls the whole sale back.
   */
  async createSale(access: EffectiveAccess, branchId: string, dto: CreateSaleDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    if (new Set(dto.lines.map((l) => l.productId)).size !== dto.lines.length) throw Errors.badRequest('duplicate_lines', 'Each product may appear once per sale');
    const replay = (tx: Tx) => this.saleReplay(tx, access, key, branchId, dto);
    return this.once(access, async (tx) => {
      const again = await replay(tx);
      if (again) return again;
      await this.activeBranch(tx, branchId);
      const session = await tx.cashierSession.findFirst({ where: { branchId, cashierUserId: access.userId, status: 'OPEN' }, select: { id: true, currency: true } });
      if (!session) throw Errors.conflict('no_open_session', 'Open a cashier session at this branch first');
      if (dto.customerId) {
        const c = await this.customers.visible(tx, access, dto.customerId);
        if (c.status !== 'ACTIVE') throw Errors.conflict('customer_inactive', 'The customer is inactive');
      }
      if (dto.relatedReturnId && !(await tx.saleReturn.findUnique({ where: { id: dto.relatedReturnId }, select: { id: true } }))) throw Errors.notFound('Return');
      const products = await tx.product.findMany({
        where: { id: { in: dto.lines.map((l) => l.productId) } }, select: { id: true, status: true, quantityScale: true, sellingPriceMinor: true, currency: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      const lines = dto.lines.map((l) => {
        const p = byId.get(l.productId);
        if (!p || p.status !== 'ACTIVE') throw Errors.notFound(`Product ${l.productId}`);
        if (p.sellingPriceMinor === null) throw Errors.conflict('no_selling_price', `Product ${l.productId} has no selling price`);
        if (p.currency !== session.currency) throw Errors.conflict('currency_mismatch', `Product ${l.productId} is priced in ${p.currency}`);
        const quantity = parseQuantity(l.quantity, p.quantityScale, 'positive');
        return { productId: p.id, quantity, unitPriceMinor: p.sellingPriceMinor, lineTotalMinor: lineTotalMinor(quantity, p.sellingPriceMinor) };
      });
      const total = lines.reduce((s, l) => s + l.lineTotalMinor, 0n);
      const [{ last_value: n }] = await tx.$queryRaw<{ last_value: number }[]>`
        INSERT INTO organization_sequences (organization_id, name, last_value) VALUES (${access.organizationId}::uuid, 'sale', 1)
        ON CONFLICT (organization_id, name) DO UPDATE SET last_value = organization_sequences.last_value + 1
        RETURNING last_value`;
      const sale = await tx.sale.create({
        data: {
          organizationId: access.organizationId, branchId, sessionId: session.id, customerId: dto.customerId ?? null, number: `R-${String(n).padStart(6, '0')}`,
          idempotencyKey: key, currency: session.currency, totalMinor: total, relatedReturnId: dto.relatedReturnId ?? null, cashierUserId: access.userId,
        },
      });
      // Stock out through the ledger: locked balances, no negative stock, posted in a fixed order.
      const moves = await postMovements(tx, lines.map((l) => ({
        organizationId: access.organizationId, branchId, productId: l.productId, type: 'SALE' as const, quantityDelta: l.quantity.negated(),
        reason: `Sale ${sale.number}`, actorUserId: access.userId, idempotencyKey: `sale:${sale.id}:${l.productId}`, sourceType: 'SALE' as const, sourceId: sale.id,
      })));
      await tx.saleLine.createMany({
        data: lines.map((l, i) => ({ organizationId: access.organizationId, saleId: sale.id, lineNo: i + 1, ...l, movementId: moves[i]!.id })),
      });
      await this.audit.record(tx, {
        action: 'sales.sale.posted', resourceType: 'sale', resourceId: sale.id, organizationId: access.organizationId, branchId, actorUserId: access.userId,
        metadata: { number: sale.number, totalMinor: total.toString(), lines: lines.length, sessionId: session.id, customerId: dto.customerId ?? null },
      }, meta);
      return { replayed: false, sale: await this.loadSale(tx, sale.id) };
    }, replay);
  }

  listSales(access: EffectiveAccess, q: ListSalesQuery) {
    const branches = branchesWith(access, 'sales.sale.read');
    const limit = q.limit ?? 50;
    const cursor = decodeCursor(q.cursor);
    if (branches !== 'ALL' && branches.length === 0) throw Errors.forbidden();
    if (branches !== 'ALL' && q.branchId && !branches.includes(q.branchId)) return Promise.resolve({ items: [], nextCursor: null });
    return this.db.inOrg(access, async (tx) => {
      const rows = await tx.sale.findMany({
        where: {
          AND: [
            branches === 'ALL' ? {} : { branchId: { in: branches } }, q.branchId ? { branchId: q.branchId } : {}, q.status ? { status: q.status } : {},
            q.customerId ? { customerId: q.customerId } : {}, q.sessionId ? { sessionId: q.sessionId } : {},
            cursor ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {},
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map((s) => ({
          id: s.id, number: s.number, status: s.status, branchId: s.branchId, sessionId: s.sessionId, customerId: s.customerId, currency: s.currency,
          totalMinor: fmtMinor(s.totalMinor), cashierUserId: s.cashierUserId, createdAt: s.createdAt,
        })),
        nextCursor: rows.length > limit ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
      };
    });
  }

  getSale(access: EffectiveAccess, saleId: string) {
    return this.db.inOrg(access, async (tx) => {
      const s = await tx.sale.findUnique({ where: { id: saleId }, select: { branchId: true } });
      if (!s || !can(access, 'sales.sale.read', s.branchId)) throw Errors.notFound('Sale');
      return this.loadSale(tx, saleId);
    });
  }

  /**
   * Voids a posted sale: only with nothing paid outstanding (no pending payments, confirmed
   * payments fully refunded) and no returns. Posts SALE_VOID movements bringing the goods back
   * (the void itself is the explicit, authorized restoration). History is kept.
   */
  voidSale(access: EffectiveAccess, saleId: string, version: number, reason: string, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertWritable(tx, access.organizationId);
      const sale = await this.lockSale(tx, access, saleId, 'sales.sale.void');
      if (sale.status !== 'COMPLETED') throw Errors.conflict('sale_voided', 'The sale is already voided');
      if (sale.version !== version) throw versionConflict(sale.version);
      const full = await this.loadRaw(tx, saleId);
      if (full.returns.length) throw Errors.conflict('sale_has_returns', 'Goods were returned against this sale; it cannot be voided');
      if (full.payments.some((p) => p.status === 'PENDING' || (p.status === 'CONFIRMED' && p.refundedMinor !== p.amountMinor))) {
        throw Errors.conflict('payments_outstanding', 'Refund or fail every payment before voiding the sale');
      }
      await this.activeBranch(tx, sale.branch_id);
      await postMovements(tx, full.lines.map((l) => ({
        organizationId: access.organizationId, branchId: sale.branch_id, productId: l.productId, type: 'SALE_VOID' as const, quantityDelta: l.quantity,
        reason: `Void of ${full.number}: ${reason.trim()}`, actorUserId: access.userId, idempotencyKey: `sale-void:${saleId}:${l.productId}`, sourceType: 'SALE_VOID' as const, sourceId: saleId,
      })));
      await tx.sale.update({ where: { id: saleId }, data: { status: 'VOIDED', voidedAt: new Date(), voidedByUserId: access.userId, voidReason: reason.trim() } });
      await this.audit.record(tx, {
        action: 'sales.sale.voided', resourceType: 'sale', resourceId: saleId, organizationId: access.organizationId, branchId: sale.branch_id,
        actorUserId: access.userId, metadata: { number: full.number, reason: reason.trim(), totalMinor: full.totalMinor.toString() },
      }, meta);
      return this.loadSale(tx, saleId);
    });
  }

  // ---------------------------------------------------------------- payments

  /**
   * Records a payment. Cash is confirmed on receipt and must go into the recorder's open
   * session at the sale's branch; other methods start PENDING until a staff member confirms
   * them (manual attestation: nothing is verified with a bank or processor). Recorded totals
   * can never exceed the sale total.
   */
  async recordPayment(access: EffectiveAccess, saleId: string, dto: RecordPaymentDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    const amount = parseMinor(dto.amountMinor, 'amountMinor')!;
    if (amount <= 0n) throw Errors.badRequest('invalid_amount', 'amountMinor must be greater than zero');
    if (dto.reference && CARD_LIKE.test(dto.reference.replace(/[\s-]/g, ''))) {
      throw Errors.badRequest('card_data_refused', 'Never enter card numbers: use the terminal\'s transaction reference');
    }
    const replay = async (tx: Tx) => {
      const p = await tx.payment.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } } });
      if (!p) return null;
      if (p.saleId !== saleId || p.amountMinor !== amount || p.method !== dto.method) throw idempotencyReused();
      return { replayed: true, payment: paymentView(p) };
    };
    return this.once(access, async (tx) => {
      const again = await replay(tx);
      if (again) return again;
      const sale = await this.lockSale(tx, access, saleId, 'sales.payment.confirm');
      // A concurrent request with the same key may have committed while we waited for the lock.
      const raced = await replay(tx);
      if (raced) return raced;
      if (sale.status !== 'COMPLETED') throw Errors.conflict('sale_voided', 'The sale is voided');
      const [sum] = await tx.$queryRaw<{ s: string | null }[]>`SELECT sum(amount_minor)::text AS s FROM payments WHERE sale_id = ${saleId}::uuid AND status <> 'FAILED'`;
      const outstanding = sale.total_minor - BigInt(sum?.s ?? '0');
      if (amount > outstanding) throw Errors.conflict('overpayment', `Only ${outstanding} remains to be paid`);
      let sessionId: string | null = null;
      if (dto.method === 'CASH') {
        const session = await tx.cashierSession.findFirst({ where: { branchId: sale.branch_id, cashierUserId: access.userId, status: 'OPEN' }, select: { id: true } });
        if (!session) throw Errors.conflict('no_open_session', 'Cash must go into your open cashier session at this branch');
        sessionId = session.id;
      }
      const cash = dto.method === 'CASH';
      const p = await tx.payment.create({
        data: {
          organizationId: access.organizationId, saleId, branchId: sale.branch_id, sessionId, method: dto.method, amountMinor: amount,
          reference: dto.reference?.trim() || null, idempotencyKey: key, recordedByUserId: access.userId, status: cash ? 'CONFIRMED' : 'PENDING',
          ...(cash ? { confirmedByUserId: access.userId, confirmedAt: new Date() } : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'sales.payment.recorded', resourceType: 'payment', resourceId: p.id, organizationId: access.organizationId, branchId: sale.branch_id,
        actorUserId: access.userId, metadata: { saleId, method: p.method, amountMinor: amount.toString(), status: p.status, verification: 'MANUAL' },
      }, meta);
      return { replayed: false, payment: paymentView(p) };
    }, replay);
  }

  confirmPayment(access: EffectiveAccess, paymentId: string, version: number, meta: RequestMeta) {
    return this.transitionPayment(access, paymentId, version, 'CONFIRMED', null, meta);
  }

  failPayment(access: EffectiveAccess, paymentId: string, dto: FailPaymentDto, meta: RequestMeta) {
    return this.transitionPayment(access, paymentId, dto.version, 'FAILED', dto.reason.trim(), meta);
  }

  private transitionPayment(access: EffectiveAccess, paymentId: string, version: number, to: 'CONFIRMED' | 'FAILED', reason: string | null, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const p = await this.lockPayment(tx, access, paymentId, 'sales.payment.confirm');
      if (p.status !== 'PENDING') throw Errors.conflict('payment_not_pending', `The payment is already ${p.status.toLowerCase()}`);
      if (p.version !== version) throw versionConflict(p.version);
      const after = await tx.payment.update({
        where: { id: paymentId },
        data: to === 'CONFIRMED' ? { status: 'CONFIRMED', confirmedByUserId: access.userId, confirmedAt: new Date() } : { status: 'FAILED', failureReason: reason },
      });
      await this.audit.record(tx, {
        action: to === 'CONFIRMED' ? 'sales.payment.confirmed' : 'sales.payment.failed', resourceType: 'payment', resourceId: paymentId,
        organizationId: access.organizationId, branchId: p.branchId, actorUserId: access.userId,
        metadata: { saleId: p.saleId, method: p.method, amountMinor: p.amountMinor.toString(), verification: 'MANUAL', ...(reason ? { reason } : {}) },
      }, meta);
      return paymentView(after);
    });
  }

  // ---------------------------------------------------------------- refunds

  /**
   * Refunds part or all of a CONFIRMED payment. Cumulative refunds never exceed the payment
   * (payment row lock; CHECK constraint behind it). A refund does not restock: goods come
   * back only through a return and an explicit restock.
   */
  async refund(access: EffectiveAccess, paymentId: string, dto: RefundDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    const amount = parseMinor(dto.amountMinor, 'amountMinor')!;
    if (amount <= 0n) throw Errors.badRequest('invalid_amount', 'amountMinor must be greater than zero');
    const replay = async (tx: Tx) => {
      const r = await tx.refund.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } } });
      if (!r) return null;
      if (r.paymentId !== paymentId || r.amountMinor !== amount) throw idempotencyReused();
      return { replayed: true, refund: refundView(r) };
    };
    return this.once(access, async (tx) => {
      const again = await replay(tx);
      if (again) return again;
      const p = await this.lockPayment(tx, access, paymentId, 'sales.sale.refund');
      const raced = await replay(tx);
      if (raced) return raced;
      if (p.status !== 'CONFIRMED') throw Errors.conflict('payment_not_confirmed', 'Only confirmed payments can be refunded');
      const refundable = p.amountMinor - p.refundedMinor;
      if (amount > refundable) throw Errors.conflict('refund_exceeds_payment', `Only ${refundable} of this payment can still be refunded`);
      if (dto.returnId) {
        const ret = await tx.saleReturn.findUnique({ where: { id: dto.returnId }, select: { saleId: true } });
        if (!ret || ret.saleId !== p.saleId) throw Errors.notFound('Return');
      }
      let sessionId: string | null = null;
      if (p.method === 'CASH') {
        const session = await tx.cashierSession.findFirst({ where: { branchId: p.branchId, cashierUserId: access.userId, status: 'OPEN' }, select: { id: true } });
        if (!session) throw Errors.conflict('no_open_session', 'Cash refunds come out of your open cashier session at this branch');
        sessionId = session.id;
      }
      const r = await tx.refund.create({
        data: {
          organizationId: access.organizationId, saleId: p.saleId, paymentId, returnId: dto.returnId ?? null, sessionId, method: p.method,
          amountMinor: amount, reason: dto.reason.trim(), idempotencyKey: key, actorUserId: access.userId,
        },
      });
      await tx.payment.update({ where: { id: paymentId }, data: { refundedMinor: { increment: amount } } });
      await this.audit.record(tx, {
        action: 'sales.payment.refunded', resourceType: 'refund', resourceId: r.id, organizationId: access.organizationId, branchId: p.branchId,
        actorUserId: access.userId, metadata: { saleId: p.saleId, paymentId, amountMinor: amount.toString(), reason: dto.reason.trim(), returnId: dto.returnId ?? null },
      }, meta);
      return { replayed: false, refund: refundView(r) };
    }, replay);
  }

  // ---------------------------------------------------------------- returns

  /**
   * Accepts returned goods: returnable quantities are checked under the sale lock, per line,
   * with a disposition. Stock is NOT restored here (damaged or unsellable goods never are);
   * resaleable goods come back only through restock().
   */
  async acceptReturn(access: EffectiveAccess, saleId: string, dto: AcceptReturnDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    if (new Set(dto.lines.map((l) => l.saleLineId)).size !== dto.lines.length) throw Errors.badRequest('duplicate_lines', 'Each sale line may appear once per return');
    const replay = async (tx: Tx) => {
      const r = await tx.saleReturn.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } }, include: { lines: true } });
      if (!r) return null;
      if (r.saleId !== saleId) throw idempotencyReused();
      return { replayed: true, return: returnView(r) };
    };
    return this.once(access, async (tx) => {
      const again = await replay(tx);
      if (again) return again;
      const sale = await this.lockSale(tx, access, saleId, 'sales.return.accept');
      const raced = await replay(tx);
      if (raced) return raced;
      if (sale.status !== 'COMPLETED') throw Errors.conflict('sale_voided', 'Voided sales cannot be returned against');
      await this.activeBranch(tx, sale.branch_id);
      const lines = await tx.saleLine.findMany({ where: { saleId }, include: { product: { select: { quantityScale: true } } } });
      const byId = new Map(lines.map((l) => [l.id, l]));
      const qty = dto.lines.map((l) => {
        const line = byId.get(l.saleLineId);
        if (!line) throw Errors.notFound(`Sale line ${l.saleLineId}`);
        const q = parseQuantity(l.quantity, line.product.quantityScale, 'positive');
        const left = line.quantity.minus(line.quantityReturned);
        if (q.greaterThan(left)) throw Errors.conflict('exceeds_returnable', `Line ${line.lineNo}: only ${fmtQty(left)} can still be returned`);
        return q;
      });
      const ret = await tx.saleReturn.create({
        data: { organizationId: access.organizationId, saleId, branchId: sale.branch_id, idempotencyKey: key, reason: dto.reason.trim(), acceptedByUserId: access.userId },
      });
      await tx.saleReturnLine.createMany({
        data: dto.lines.map((l, i) => ({ organizationId: access.organizationId, returnId: ret.id, saleLineId: l.saleLineId, quantity: qty[i], disposition: l.disposition })),
      });
      for (const [i, l] of dto.lines.entries()) await tx.saleLine.update({ where: { id: l.saleLineId }, data: { quantityReturned: { increment: qty[i] } } });
      await this.audit.record(tx, {
        action: 'sales.return.accepted', resourceType: 'sale_return', resourceId: ret.id, organizationId: access.organizationId, branchId: sale.branch_id,
        actorUserId: access.userId,
        metadata: { saleId, reason: dto.reason.trim(), lines: dto.lines.map((l, i) => ({ saleLineId: l.saleLineId, quantity: qty[i].toFixed(3), disposition: l.disposition })) },
      }, meta);
      return { replayed: false, return: returnView(await tx.saleReturn.findUniqueOrThrow({ where: { id: ret.id }, include: { lines: true } })) };
    }, replay);
  }

  /**
   * Restores RESALEABLE returned goods to stock (SALE_RETURN movements, linked to the return).
   * Separate permission from accepting returns; once per return.
   */
  restock(access: EffectiveAccess, returnId: string, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertWritable(tx, access.organizationId);
      const [locked] = await tx.$queryRaw<{ id: string; branch_id: string; status: string }[]>`
        SELECT id, branch_id, status::text AS status FROM sale_returns WHERE id = ${returnId}::uuid FOR UPDATE`;
      if (!locked || !(can(access, 'sales.sale.read', locked.branch_id) || can(access, 'sales.return.restock', locked.branch_id))) throw Errors.notFound('Return');
      if (!can(access, 'sales.return.restock', locked.branch_id)) throw Errors.forbidden();
      if (locked.status !== 'ACCEPTED') throw Errors.conflict('already_restocked', 'This return was already restocked');
      const ret = await tx.saleReturn.findUniqueOrThrow({ where: { id: returnId }, include: { lines: { include: { saleLine: { select: { productId: true } } } } } });
      const resaleable = ret.lines.filter((l) => l.disposition === 'RESALEABLE');
      if (!resaleable.length) throw Errors.conflict('nothing_to_restock', 'No returned line is resaleable; damaged and unsellable goods are not restocked');
      await this.activeBranch(tx, ret.branchId);
      await postMovements(tx, resaleable.map((l) => ({
        organizationId: access.organizationId, branchId: ret.branchId, productId: l.saleLine.productId, type: 'SALE_RETURN' as const, quantityDelta: l.quantity,
        reason: `Restock of return ${ret.id}`, actorUserId: access.userId, idempotencyKey: `sale-return:${ret.id}:${l.saleLineId}`, sourceType: 'SALE_RETURN' as const, sourceId: ret.id,
      })));
      await tx.saleReturn.update({ where: { id: returnId }, data: { status: 'RESTOCKED', restockedByUserId: access.userId, restockedAt: new Date() } });
      await this.audit.record(tx, {
        action: 'sales.return.restocked', resourceType: 'sale_return', resourceId: returnId, organizationId: access.organizationId, branchId: ret.branchId,
        actorUserId: access.userId, metadata: { saleId: ret.saleId, lines: resaleable.map((l) => ({ saleLineId: l.saleLineId, quantity: l.quantity.toFixed(3) })), notRestocked: ret.lines.length - resaleable.length },
      }, meta);
      return returnView(await tx.saleReturn.findUniqueOrThrow({ where: { id: returnId }, include: { lines: true } }));
    });
  }

  // ---------------------------------------------------------------- reports

  report(access: EffectiveAccess, q: SalesReportQuery) {
    const createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(new Date(q.to).getTime() + 86_400_000) } : {}) };
    const where = { ...(Object.keys(createdAt).length ? { createdAt } : {}), ...(q.branchId ? { branchId: q.branchId } : {}) };
    return this.db.inOrg(access, async (tx) => {
      const sales = await tx.sale.groupBy({ by: ['status', 'currency'], where, _count: { _all: true }, _sum: { totalMinor: true } });
      const payments = await tx.payment.groupBy({ by: ['method', 'status'], where, _count: { _all: true }, _sum: { amountMinor: true, refundedMinor: true } });
      const refunds = await tx.refund.aggregate({ where: { ...(Object.keys(createdAt).length ? { createdAt } : {}), ...(q.branchId ? { sale: { branchId: q.branchId } } : {}) }, _count: { _all: true }, _sum: { amountMinor: true } });
      return {
        period: { from: q.from ?? null, to: q.to ?? null }, branchId: q.branchId ?? null,
        sales: sales.map((r) => ({ status: r.status, currency: r.currency, count: r._count._all, totalMinor: fmtMinor(r._sum.totalMinor ?? 0n) })),
        payments: payments.map((r) => ({ method: r.method, status: r.status, count: r._count._all, amountMinor: fmtMinor(r._sum.amountMinor ?? 0n), refundedMinor: fmtMinor(r._sum.refundedMinor ?? 0n) })),
        refunds: { count: refunds._count._all, amountMinor: fmtMinor(refunds._sum.amountMinor ?? 0n) },
        note: 'Payments are recorded and confirmed manually by staff; none is verified with a bank or card processor.',
      };
    });
  }

  // ---------------------------------------------------------------- internals

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

  private async saleReplay(tx: Tx, access: EffectiveAccess, key: string, branchId: string, dto: CreateSaleDto) {
    const existing = await tx.sale.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } }, include: { lines: true } });
    if (!existing) return null;
    const same = existing.branchId === branchId && existing.lines.length === dto.lines.length
      && dto.lines.every((l) => existing.lines.some((x) => x.productId === l.productId && /^\d{1,15}(\.\d{1,3})?$/.test(l.quantity) && x.quantity.equals(l.quantity)));
    if (!same) throw idempotencyReused();
    return { replayed: true, sale: await this.loadSale(tx, existing.id) };
  }

  /** Locks the sale; 404 unless the caller may see sales at its branch (or holds `permission` there); then `permission` is required. */
  private async lockSale(tx: Tx, access: EffectiveAccess, saleId: string, permission: PermissionKey) {
    const [s] = await tx.$queryRaw<{ id: string; branch_id: string; status: string; version: number; total_minor: bigint }[]>`
      SELECT id, branch_id, status::text AS status, version, total_minor FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
    if (!s || !(can(access, 'sales.sale.read', s.branch_id) || can(access, permission, s.branch_id))) throw Errors.notFound('Sale');
    if (!can(access, permission, s.branch_id)) throw Errors.forbidden();
    return { ...s, total_minor: BigInt(s.total_minor) };
  }

  private async lockPayment(tx: Tx, access: EffectiveAccess, paymentId: string, permission: PermissionKey) {
    const [locked] = await tx.$queryRaw<{ id: string; branch_id: string }[]>`SELECT id, branch_id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
    if (!locked || !(can(access, 'sales.sale.read', locked.branch_id) || can(access, permission, locked.branch_id))) throw Errors.notFound('Payment');
    if (!can(access, permission, locked.branch_id)) throw Errors.forbidden();
    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  }

  private async activeBranch(tx: Tx, branchId: string) {
    const b = await tx.branch.findUnique({ where: { id: branchId }, select: { status: true } });
    if (!b) throw Errors.notFound('Branch');
    if (b.status !== 'ACTIVE') throw Errors.conflict('branch_archived', 'This branch is archived and accepts no new transactions');
  }

  private loadRaw(tx: Tx, saleId: string): Promise<SaleFull> {
    return tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: SALE_INCLUDE });
  }

  private async loadSale(tx: Tx, saleId: string) {
    const s = await this.loadRaw(tx, saleId);
    const confirmed = s.payments.filter((p) => p.status === 'CONFIRMED').reduce((a, p) => a + p.amountMinor, 0n);
    const pending = s.payments.filter((p) => p.status === 'PENDING').reduce((a, p) => a + p.amountMinor, 0n);
    const refunded = s.refunds.reduce((a, r) => a + r.amountMinor, 0n);
    const paymentStatus = confirmed === 0n ? 'UNPAID' : confirmed >= s.totalMinor ? 'PAID' : 'PARTIALLY_PAID';
    return {
      id: s.id, number: s.number, status: s.status, branchId: s.branchId, sessionId: s.sessionId, customerId: s.customerId, currency: s.currency,
      totalMinor: fmtMinor(s.totalMinor), cashierUserId: s.cashierUserId, relatedReturnId: s.relatedReturnId, version: s.version, createdAt: s.createdAt,
      voidedAt: s.voidedAt, voidedByUserId: s.voidedByUserId, voidReason: s.voidReason,
      amounts: {
        confirmedMinor: confirmed.toString(), pendingMinor: pending.toString(), refundedMinor: refunded.toString(),
        outstandingMinor: (s.totalMinor - confirmed - pending > 0n ? s.totalMinor - confirmed - pending : 0n).toString(), paymentStatus,
        refundStatus: refunded === 0n ? 'NONE' : refunded >= confirmed ? 'FULL' : 'PARTIAL',
      },
      lines: s.lines.map((l) => ({
        id: l.id, lineNo: l.lineNo, product: l.product, quantity: fmtQty(l.quantity), unitPriceMinor: fmtMinor(l.unitPriceMinor),
        lineTotalMinor: fmtMinor(l.lineTotalMinor), quantityReturned: fmtQty(l.quantityReturned), movementId: l.movementId,
      })),
      payments: s.payments.map(paymentView),
      refunds: s.refunds.map(refundView),
      returns: s.returns.map(returnView),
    };
  }
}

function sessionView(s: Prisma.CashierSessionGetPayload<object>) {
  return {
    id: s.id, branchId: s.branchId, cashierUserId: s.cashierUserId, status: s.status, currency: s.currency, openingFloatMinor: fmtMinor(s.openingFloatMinor),
    openedAt: s.openedAt, expectedCashMinor: fmtMinor(s.expectedCashMinor), declaredCashMinor: fmtMinor(s.declaredCashMinor), varianceMinor: fmtMinor(s.varianceMinor),
    closedAt: s.closedAt, closedByUserId: s.closedByUserId, closeNote: s.closeNote, version: s.version,
  };
}

function paymentView(p: Prisma.PaymentGetPayload<object>) {
  return {
    id: p.id, saleId: p.saleId, branchId: p.branchId, sessionId: p.sessionId, method: p.method, status: p.status, amountMinor: fmtMinor(p.amountMinor),
    refundedMinor: fmtMinor(p.refundedMinor), reference: p.reference, verification: p.verification, recordedByUserId: p.recordedByUserId,
    confirmedByUserId: p.confirmedByUserId, confirmedAt: p.confirmedAt, failureReason: p.failureReason, version: p.version, createdAt: p.createdAt,
  };
}

function refundView(r: Prisma.RefundGetPayload<object>) {
  return {
    id: r.id, saleId: r.saleId, paymentId: r.paymentId, returnId: r.returnId, sessionId: r.sessionId, method: r.method, amountMinor: fmtMinor(r.amountMinor),
    reason: r.reason, actorUserId: r.actorUserId, createdAt: r.createdAt,
  };
}

function returnView(r: Prisma.SaleReturnGetPayload<{ include: { lines: true } }>) {
  return {
    id: r.id, saleId: r.saleId, branchId: r.branchId, status: r.status, reason: r.reason, acceptedByUserId: r.acceptedByUserId,
    restockedByUserId: r.restockedByUserId, restockedAt: r.restockedAt, createdAt: r.createdAt,
    lines: r.lines.map((l) => ({ saleLineId: l.saleLineId, quantity: fmtQty(l.quantity), disposition: l.disposition })),
  };
}
