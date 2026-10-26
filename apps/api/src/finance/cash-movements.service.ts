import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { branchesWith, can, type EffectiveAccess } from '../authz/permission-evaluator';
import { Prisma } from '../generated/prisma/client';
import { idempotencyReused, requireIdempotencyKey } from '../inventory/ledger';
import { fmtMinor } from '../inventory/quantity';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { sessionExpectedCash } from '../sales/session-cash';
import type { ListCashMovementsQuery, RecordCashMovementDto, ReverseCashMovementDto } from './dto/finance.dto';
import { cleanReference, optionalPeriod, positiveAmount } from './finance-common';

type Movement = Prisma.CashMovementGetPayload<{ include: { reversedBy: { select: { id: true; number: true } } } }>;
const INCLUDE = { reversedBy: { select: { id: true, number: true } } } as const;
const DIRECTION = { PAID_IN: 'IN', PAID_OUT: 'OUT', CASH_DROP: 'OUT', BANK_DEPOSIT: 'OUT', BANK_WITHDRAWAL: 'IN' } as const;

/**
 * Operational cash movements (docs/architecture/13-finance.md §3): cash put into or taken out
 * of a drawer or a branch for reasons other than sales and refunds, which stay in their own
 * authoritative records (payments, refunds) and are never recorded here.
 *
 * Postings are append-only and idempotent per Idempotency-Key. A movement linked to a cashier
 * session counts towards that session's expected cash: it is accepted only while the session is
 * OPEN, and cash taken out may not exceed what the drawer should hold (the session row is locked
 * FOR UPDATE, so movements serialize with each other and with closing). A mistake is corrected by a REVERSAL, a new movement that mirrors the original in
 * the opposite direction; the original is never changed and can be reversed at most once.
 * BANK_DEPOSIT and BANK_WITHDRAWAL record what staff report; nothing is verified with a bank.
 */
@Injectable()
export class CashMovementsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
  ) {}

  async record(access: EffectiveAccess, branchId: string, dto: RecordCashMovementDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    const amount = positiveAmount(dto.amountMinor, 'amountMinor');
    const reference = cleanReference(dto.reference);
    const reason = dto.reason.trim();
    if (dto.type === 'CASH_DROP' && !dto.sessionId) throw Errors.badRequest('session_required', 'A cash drop is taken out of a cashier session drawer: send sessionId');
    const replay = async (tx: Tx) => {
      const m = await tx.cashMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } }, include: INCLUDE });
      if (!m) return null;
      if (m.type !== dto.type || m.amountMinor !== amount || m.branchId !== branchId || m.sessionId !== (dto.sessionId ?? null) || m.recordedByUserId !== access.userId) {
        throw idempotencyReused();
      }
      return { replayed: true, movement: movementView(m) };
    };
    return this.once(access, async (tx) => {
      const again = await replay(tx);
      if (again) return again;
      const b = await tx.branch.findUnique({ where: { id: branchId }, select: { status: true } });
      if (!b) throw Errors.notFound('Branch');
      if (b.status !== 'ACTIVE') throw Errors.conflict('branch_archived', 'This branch is archived and accepts no new transactions');
      let currency: string;
      if (dto.sessionId) {
        const s = await this.lockOpenSession(tx, access, dto.sessionId, branchId);
        if (dto.currency && dto.currency !== s.currency) throw Errors.badRequest('currency_mismatch', `The session's currency is ${s.currency}`);
        if (DIRECTION[dto.type] === 'OUT') await this.assertDrawerCovers(tx, s, amount);
        currency = s.currency;
      } else {
        currency = dto.currency ?? (await tx.organization.findUniqueOrThrow({ where: { id: access.organizationId }, select: { defaultCurrency: true } })).defaultCurrency;
      }
      const number = await this.nextNumber(tx);
      const m = await tx.cashMovement.create({
        data: {
          organizationId: access.organizationId, branchId, sessionId: dto.sessionId ?? null, number, type: dto.type, direction: DIRECTION[dto.type],
          amountMinor: amount, currency, reason, reference, recordedByUserId: access.userId, idempotencyKey: key,
        },
        include: INCLUDE,
      });
      await this.audit.record(tx, {
        action: 'finance.cash.recorded', resourceType: 'cash_movement', resourceId: m.id, organizationId: access.organizationId, branchId,
        actorUserId: access.userId, metadata: { number, type: m.type, direction: m.direction, amountMinor: amount.toString(), currency, sessionId: m.sessionId },
      }, meta);
      return { replayed: false, movement: movementView(m) };
    }, replay);
  }

  async reverse(access: EffectiveAccess, movementId: string, dto: ReverseCashMovementDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    const reason = dto.reason.trim();
    const replay = async (tx: Tx) => {
      const m = await tx.cashMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } }, include: INCLUDE });
      if (!m) return null;
      if (m.reversesId !== movementId || m.recordedByUserId !== access.userId) throw idempotencyReused();
      return { replayed: true, movement: movementView(m) };
    };
    return this.once(access, async (tx) => {
      const again = await replay(tx);
      if (again) return again;
      // No row lock (the table is append-only: no UPDATE privilege, so no FOR UPDATE): concurrent
      // reversals of one movement are decided by the unique reverses_id (the loser gets 409).
      const o = await tx.cashMovement.findUnique({ where: { id: movementId }, include: INCLUDE });
      if (!o || !this.mayRead(access, o.branchId)) throw Errors.notFound('Cash movement');
      if (!can(access, 'finance.cash.reverse', o.branchId)) throw Errors.forbidden();
      if (o.type === 'REVERSAL') throw Errors.conflict('cannot_reverse_reversal', 'A reversal cannot itself be reversed; record a new movement instead');
      if (o.reversedBy.length) throw Errors.conflict('already_reversed', 'This movement has already been reversed');
      if (o.sessionId) {
        const [s] = await tx.$queryRaw<{ id: string; status: string; opening_float_minor: bigint }[]>`
          SELECT id, status::text AS status, opening_float_minor FROM cashier_sessions WHERE id = ${o.sessionId}::uuid FOR UPDATE`;
        // A closed session's count is final: correct it with a new branch-level movement instead.
        if (s?.status !== 'OPEN') throw Errors.conflict('session_closed', "The movement's cashier session is closed; record a new movement instead");
        if (o.direction === 'IN') await this.assertDrawerCovers(tx, s, o.amountMinor);
      }
      const number = await this.nextNumber(tx);
      const r = await tx.cashMovement.create({
        data: {
          organizationId: access.organizationId, branchId: o.branchId, sessionId: o.sessionId, number, type: 'REVERSAL',
          direction: o.direction === 'IN' ? 'OUT' : 'IN', amountMinor: o.amountMinor, currency: o.currency, reason,
          reference: o.number, recordedByUserId: access.userId, idempotencyKey: key, reversesId: o.id,
        },
        include: INCLUDE,
      });
      await this.audit.record(tx, {
        action: 'finance.cash.reversed', resourceType: 'cash_movement', resourceId: r.id, organizationId: access.organizationId, branchId: o.branchId,
        actorUserId: access.userId, metadata: { number, reverses: o.id, reversesNumber: o.number, amountMinor: o.amountMinor.toString(), currency: o.currency, reason },
      }, meta);
      return { replayed: false, movement: movementView(r) };
    }, replay);
  }

  get(access: EffectiveAccess, movementId: string) {
    return this.db.inOrg(access, async (tx) => {
      const m = await tx.cashMovement.findUnique({ where: { id: movementId }, include: INCLUDE });
      if (!m || !this.mayRead(access, m.branchId)) throw Errors.notFound('Cash movement');
      return movementView(m);
    });
  }

  list(access: EffectiveAccess, q: ListCashMovementsQuery) {
    const limit = q.limit ?? 50;
    const cursor = decodeCursor(q.cursor);
    const period = optionalPeriod(q.from, q.to);
    const scope = this.readScope(access);
    if (scope !== 'ALL' && scope.length === 0) throw Errors.forbidden();
    if (q.branchId && scope !== 'ALL' && !scope.includes(q.branchId)) return Promise.resolve({ items: [], nextCursor: null });
    return this.db.inOrg(access, async (tx) => {
      const rows = await tx.cashMovement.findMany({
        where: {
          AND: [
            scope === 'ALL' ? {} : { branchId: { in: scope } },
            q.branchId ? { branchId: q.branchId } : {},
            q.sessionId ? { sessionId: q.sessionId } : {},
            q.type ? { type: q.type } : {},
            period ? { createdAt: { gte: period.from, lt: period.end } } : {},
            cursor ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {},
          ],
        },
        include: INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map(movementView),
        nextCursor: rows.length > limit ? encodeCursor({ at: page[page.length - 1].createdAt, id: page[page.length - 1].id }) : null,
      };
    });
  }

  // ---------------------------------------------------------------- internals

  private readScope(access: EffectiveAccess): 'ALL' | string[] {
    const read = branchesWith(access, 'finance.cash.read');
    const record = branchesWith(access, 'finance.cash.record');
    if (read === 'ALL' || record === 'ALL') return 'ALL';
    return [...new Set([...read, ...record])];
  }

  private mayRead(access: EffectiveAccess, branchId: string): boolean {
    return can(access, 'finance.cash.read', branchId) || can(access, 'finance.cash.record', branchId);
  }

  /**
   * The session must be OPEN at this branch, and the caller must be its cashier or hold
   * sales.session.supervise there. Locked FOR UPDATE until commit: other movements and closing wait.
   */
  private async lockOpenSession(tx: Tx, access: EffectiveAccess, sessionId: string, branchId: string) {
    const [s] = await tx.$queryRaw<{ id: string; branch_id: string; cashier_user_id: string; status: string; currency: string; opening_float_minor: bigint }[]>`
      SELECT id, branch_id, cashier_user_id, status::text AS status, currency, opening_float_minor FROM cashier_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    const supervisor = s ? can(access, 'sales.session.supervise', s.branch_id) : false;
    if (!s || s.branch_id !== branchId || (s.cashier_user_id !== access.userId && !supervisor)) throw Errors.notFound('Cashier session');
    if (s.status !== 'OPEN') throw Errors.conflict('session_closed', 'This cashier session is closed');
    return s;
  }

  /** Cash taken out of a drawer may not exceed what it should hold (expected cash so far). */
  private async assertDrawerCovers(tx: Tx, s: { id: string; opening_float_minor: bigint }, amount: bigint) {
    const expected = await sessionExpectedCash(tx, s.id, s.opening_float_minor);
    if (amount > expected) throw Errors.conflict('insufficient_drawer_cash', `The drawer should hold ${expected.toString()} (minor units); this would take it below zero`);
  }

  /** C-000001…, per organization (the tenant context's organization, as RLS requires). */
  private async nextNumber(tx: Tx): Promise<string> {
    const [seq] = await tx.$queryRaw<{ last_value: bigint }[]>`
      INSERT INTO organization_sequences (organization_id, name, last_value) VALUES (app_current_org_id(), 'cash_movement', 1)
      ON CONFLICT (organization_id, name) DO UPDATE SET last_value = organization_sequences.last_value + 1
      RETURNING last_value`;
    return `C-${seq.last_value.toString().padStart(6, '0')}`;
  }

  private async once<T>(access: EffectiveAccess, post: (tx: Tx) => Promise<T>, replay: (tx: Tx) => Promise<T | null>): Promise<T> {
    try {
      return await this.db.inOrg(access, async (tx) => {
        await this.entitlements.assertWritable(tx, access.organizationId);
        return post(tx);
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const again = await this.db.inOrg(access, (tx) => replay(tx));
      if (again) return again;
      if (/reverses_id/.test(`${e.message} ${JSON.stringify(e.meta ?? {})}`)) throw Errors.conflict('already_reversed', 'This movement has already been reversed');
      throw Errors.conflict('already_posted', 'This operation was already posted');
    }
  }
}

export function movementView(m: Movement) {
  return {
    id: m.id, number: m.number, branchId: m.branchId, sessionId: m.sessionId, type: m.type, direction: m.direction, amountMinor: fmtMinor(m.amountMinor),
    currency: m.currency, reason: m.reason, reference: m.reference, recordedByUserId: m.recordedByUserId, reversesId: m.reversesId,
    reversedBy: m.reversedBy[0] ?? null, verification: 'RECORDED' as const, createdAt: m.createdAt,
  };
}
