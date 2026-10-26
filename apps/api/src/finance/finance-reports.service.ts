import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ApiError, Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import type { ExpenseSummaryQuery, ExportKind, FinancePeriodQuery } from './dto/finance.dto';
import { csvRow, fmtDate, MAX_EXPORT_ROWS, parsePeriod, type Period } from './finance-common';

/**
 * Every figure is an aggregate computed by PostgreSQL over the authoritative records, under the
 * caller's tenant RLS context, and kept separate per currency (no exchange rates exist).
 * The response carries these definitions verbatim (docs/architecture/13-finance.md §4).
 */
export const METRIC_DEFINITIONS = {
  period: 'Inclusive UTC calendar days [from, to]. Timestamps are compared with [from 00:00Z, to+1 00:00Z); expense dates (occurredOn) with from ≤ occurredOn ≤ to.',
  amounts: 'Integer minor units of the stated currency, as strings. Totals are never combined across currencies.',
  'expenses.approved': 'Expenses with status APPROVED and occurredOn in the period. VOIDED, REJECTED, CANCELLED, SUBMITTED and DRAFT expenses are excluded.',
  'expenses.pending': 'Expenses with status SUBMITTED (awaiting a decision) and occurredOn in the period.',
  'expenses.byStatus': 'Count and amount per status, informational. Only APPROVED counts as an expense incurred.',
  'sales.gross': 'Sum of totalMinor of COMPLETED sales created in the period: server-priced line totals. The schema has no discounts or taxes, so none are deducted or added. VOIDED sales are excluded (reported separately).',
  'payments.confirmed': 'Payments with status CONFIRMED, by confirmation time (confirmedAt) in the period, by method. Manual staff attestation; nothing is verified with a bank or card processor.',
  'payments.pending': 'Payments with status PENDING recorded in the period (not money received).',
  refunds: 'Refunds created in the period, by method, in the currency of the refunded sale. A refund may concern a sale from an earlier period.',
  returns: 'Count of sale returns accepted in the period, by status. Returns carry no amount of their own; any money back is a refund.',
  'cash.in / cash.out': 'Operational cash movements recorded in the period (paid in/out, cash drops, bank deposits and withdrawals), reversals included in their own direction, so a reversed movement nets to zero. Sales and refunds are never cash movements.',
  'derived.paymentsLessRefunds': 'payments.confirmed − refunds, both for the period: money collected net of money returned. Not revenue, not profit.',
} as const;

const LIMITATIONS = [
  'No exchange rates: totals are per currency only.',
  'No taxes, discounts, cost of goods sold or general ledger: no profit or net-revenue figure is produced.',
  'Purchases (goods receipts) are inventory cost and are not expenses; see the purchasing report.',
  'Bank deposits and withdrawals are recorded statements, not reconciled with any bank.',
  'Dates are UTC; organizations have no time zone setting yet.',
];

type Row = Record<string, string | number | null>;
const add = (a: string, b: string | null | undefined) => (BigInt(a) + BigInt(b ?? '0')).toString();

@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  summary(access: EffectiveAccess, q: FinancePeriodQuery) {
    const p = parsePeriod(q.from, q.to);
    const branch = q.branchId ?? null;
    return this.db.inOrg(access, async (tx) => {
      if (branch) await this.assertBranch(tx, branch);
      // Sequential: one transaction is one connection (and one consistent RLS context).
      const expenses = await tx.$queryRaw<Row[]>`
          SELECT currency, status::text AS status, count(*)::int AS n, sum(amount_minor)::text AS amount FROM expenses
          WHERE occurred_on BETWEEN ${fmtDate(p.from)}::date AND ${fmtDate(p.to)}::date AND (${branch}::uuid IS NULL OR branch_id = ${branch}::uuid)
          GROUP BY 1, 2`;
      const sales = await tx.$queryRaw<Row[]>`
          SELECT currency, status::text AS status, count(*)::int AS n, sum(total_minor)::text AS amount FROM sales
          WHERE created_at >= ${p.from} AND created_at < ${p.end} AND (${branch}::uuid IS NULL OR branch_id = ${branch}::uuid)
          GROUP BY 1, 2`;
      const payments = await tx.$queryRaw<Row[]>`
          SELECT s.currency, p.method::text AS method, p.status::text AS status, count(*)::int AS n, sum(p.amount_minor)::text AS amount
          FROM payments p JOIN sales s ON s.id = p.sale_id
          WHERE (CASE WHEN p.status = 'CONFIRMED' THEN coalesce(p.confirmed_at, p.created_at) ELSE p.created_at END) >= ${p.from}
            AND (CASE WHEN p.status = 'CONFIRMED' THEN coalesce(p.confirmed_at, p.created_at) ELSE p.created_at END) < ${p.end}
            AND (${branch}::uuid IS NULL OR p.branch_id = ${branch}::uuid)
          GROUP BY 1, 2, 3`;
      const refunds = await tx.$queryRaw<Row[]>`
          SELECT s.currency, r.method::text AS method, count(*)::int AS n, sum(r.amount_minor)::text AS amount
          FROM refunds r JOIN sales s ON s.id = r.sale_id
          WHERE r.created_at >= ${p.from} AND r.created_at < ${p.end} AND (${branch}::uuid IS NULL OR s.branch_id = ${branch}::uuid)
          GROUP BY 1, 2`;
      const returns = await tx.$queryRaw<Row[]>`
          SELECT status::text AS status, count(*)::int AS n FROM sale_returns
          WHERE created_at >= ${p.from} AND created_at < ${p.end} AND (${branch}::uuid IS NULL OR branch_id = ${branch}::uuid)
          GROUP BY 1`;
      const cash = await tx.$queryRaw<Row[]>`
          SELECT currency, type::text AS type, direction::text AS direction, count(*)::int AS n, sum(amount_minor)::text AS amount FROM cash_movements
          WHERE created_at >= ${p.from} AND created_at < ${p.end} AND (${branch}::uuid IS NULL OR branch_id = ${branch}::uuid)
          GROUP BY 1, 2, 3`;
      const currencies = [...new Set([...expenses, ...sales, ...payments, ...refunds, ...cash].map((r) => r.currency as string))].sort();
      const sum = (rows: Row[], match: (r: Row) => boolean) => {
        const hit = rows.filter(match);
        return { count: hit.reduce((n, r) => n + Number(r.n), 0), amountMinor: hit.reduce((a, r) => add(a, r.amount as string), '0') };
      };
      return {
        period: { from: fmtDate(p.from), to: fmtDate(p.to), timeZone: 'UTC' }, branchId: branch,
        currencies: currencies.map((c) => {
          const inC = (rows: Row[]) => rows.filter((r) => r.currency === c);
          const ex = inC(expenses);
          const pay = inC(payments);
          const ref = inC(refunds);
          const cm = inC(cash);
          const confirmed = sum(pay, (r) => r.status === 'CONFIRMED');
          const refunded = sum(ref, () => true);
          const cashIn = sum(cm, (r) => r.direction === 'IN');
          const cashOut = sum(cm, (r) => r.direction === 'OUT');
          return {
            currency: c,
            expenses: {
              approved: sum(ex, (r) => r.status === 'APPROVED'),
              pending: sum(ex, (r) => r.status === 'SUBMITTED'),
              byStatus: Object.fromEntries(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'VOIDED'].map((s) => [s, sum(ex, (r) => r.status === s)])),
            },
            sales: { gross: sum(inC(sales), (r) => r.status === 'COMPLETED'), voided: sum(inC(sales), (r) => r.status === 'VOIDED') },
            payments: {
              confirmed,
              pending: sum(pay, (r) => r.status === 'PENDING'),
              failed: sum(pay, (r) => r.status === 'FAILED'),
              confirmedByMethod: Object.fromEntries([...new Set(pay.map((r) => r.method as string))].sort().map((m) => [m, sum(pay, (r) => r.method === m && r.status === 'CONFIRMED')])),
            },
            refunds: { ...refunded, byMethod: Object.fromEntries(ref.map((r) => [r.method, { count: Number(r.n), amountMinor: r.amount }])) },
            cash: {
              in: cashIn, out: cashOut, netMinor: (BigInt(cashIn.amountMinor) - BigInt(cashOut.amountMinor)).toString(),
              byType: cm.map((r) => ({ type: r.type, direction: r.direction, count: Number(r.n), amountMinor: r.amount })),
            },
            derived: { paymentsLessRefundsMinor: (BigInt(confirmed.amountMinor) - BigInt(refunded.amountMinor)).toString() },
          };
        }),
        returns: { count: returns.reduce((n, r) => n + Number(r.n), 0), byStatus: Object.fromEntries(returns.map((r) => [r.status, Number(r.n)])) },
        definitions: METRIC_DEFINITIONS,
        limitations: LIMITATIONS,
      };
    });
  }

  expenseSummary(access: EffectiveAccess, q: ExpenseSummaryQuery) {
    const p = parsePeriod(q.from, q.to);
    const branch = q.branchId ?? null;
    return this.db.inOrg(access, async (tx) => {
      if (branch) await this.assertBranch(tx, branch);
      const rows = await tx.$queryRaw<Row[]>`
        SELECT CASE ${q.groupBy}::text
                 WHEN 'category' THEN e.category_id::text
                 WHEN 'branch' THEN e.branch_id::text
                 WHEN 'month' THEN to_char(e.occurred_on, 'YYYY-MM')
                 ELSE e.status::text END AS key,
               CASE ${q.groupBy}::text WHEN 'category' THEN c.name WHEN 'branch' THEN b.name ELSE NULL END AS label,
               e.currency, e.status::text AS status, count(*)::int AS n, sum(e.amount_minor)::text AS amount
        FROM expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN branches b ON b.id = e.branch_id
        WHERE e.occurred_on BETWEEN ${fmtDate(p.from)}::date AND ${fmtDate(p.to)}::date AND (${branch}::uuid IS NULL OR e.branch_id = ${branch}::uuid)
        GROUP BY 1, 2, 3, 4 ORDER BY 1 NULLS FIRST, 3, 4`;
      const groups = new Map<string, { key: string | null; label: string | null; currency: string; byStatus: Record<string, { count: number; amountMinor: string }> }>();
      for (const r of rows) {
        const id = `${r.key ?? ''}|${r.currency}`;
        const g = groups.get(id) ?? { key: (r.key as string) ?? null, label: (r.label as string) ?? null, currency: r.currency as string, byStatus: {} };
        g.byStatus[r.status as string] = { count: Number(r.n), amountMinor: r.amount as string };
        groups.set(id, g);
      }
      const zero = { count: 0, amountMinor: '0' };
      return {
        period: { from: fmtDate(p.from), to: fmtDate(p.to), timeZone: 'UTC' }, branchId: branch, groupBy: q.groupBy,
        groups: [...groups.values()].map((g) => ({
          key: g.key, label: g.label, currency: g.currency,
          approved: g.byStatus.APPROVED ?? zero, pending: g.byStatus.SUBMITTED ?? zero, byStatus: g.byStatus,
        })),
        definitions: { approved: METRIC_DEFINITIONS['expenses.approved'], pending: METRIC_DEFINITIONS['expenses.pending'], key: 'groupBy=branch: null is organization-level expenses' },
      };
    });
  }

  cashSessionSummary(access: EffectiveAccess, q: FinancePeriodQuery) {
    const p = parsePeriod(q.from, q.to);
    const branch = q.branchId ?? null;
    return this.db.inOrg(access, async (tx) => {
      if (branch) await this.assertBranch(tx, branch);
      const closed = await tx.$queryRaw<Row[]>`
        SELECT currency, count(*)::int AS n, sum(expected_cash_minor)::text AS expected, sum(declared_cash_minor)::text AS declared,
               sum(variance_minor)::text AS variance, count(*) FILTER (WHERE variance_minor < 0)::int AS short, count(*) FILTER (WHERE variance_minor > 0)::int AS over
        FROM cashier_sessions
        WHERE status = 'CLOSED' AND closed_at >= ${p.from} AND closed_at < ${p.end} AND (${branch}::uuid IS NULL OR branch_id = ${branch}::uuid)
        GROUP BY 1 ORDER BY 1`;
      const open = await tx.$queryRaw<Row[]>`
        SELECT currency, count(*)::int AS n FROM cashier_sessions
        WHERE status = 'OPEN' AND opened_at < ${p.end} AND (${branch}::uuid IS NULL OR branch_id = ${branch}::uuid) GROUP BY 1 ORDER BY 1`;
      return {
        period: { from: fmtDate(p.from), to: fmtDate(p.to), timeZone: 'UTC' }, branchId: branch,
        closed: closed.map((r) => ({
          currency: r.currency, sessions: Number(r.n), expectedCashMinor: r.expected, declaredCashMinor: r.declared, varianceMinor: r.variance,
          sessionsShort: Number(r.short), sessionsOver: Number(r.over),
        })),
        stillOpen: open.map((r) => ({ currency: r.currency, sessions: Number(r.n) })),
        definitions: {
          closed: 'Sessions closed in the period. expected = opening float + confirmed cash payments − cash refunds + cash movements in − out (computed at close); variance = declared − expected.',
          stillOpen: 'Sessions open now that were opened before the end of the period (not yet counted).',
        },
      };
    });
  }

  /** CSV export, refused (not truncated) above MAX_EXPORT_ROWS rows; audited. */
  async export(access: EffectiveAccess, kind: ExportKind, q: FinancePeriodQuery, meta: RequestMeta): Promise<{ fileName: string; csv: string; rows: number }> {
    const p = parsePeriod(q.from, q.to);
    const branch = q.branchId ?? null;
    return this.db.inOrg(access, async (tx) => {
      if (branch) await this.assertBranch(tx, branch);
      const { header, rows } = kind === 'expenses' ? await this.expenseRows(tx, p, branch) : await this.cashRows(tx, p, branch);
      if (rows.length > MAX_EXPORT_ROWS) {
        throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'export_too_large', `The export has more than ${MAX_EXPORT_ROWS} rows; narrow the period or filter by branch`);
      }
      await this.audit.record(tx, {
        action: 'finance.export.generated', resourceType: 'finance_export', organizationId: access.organizationId, branchId: branch, actorUserId: access.userId,
        metadata: { kind, from: fmtDate(p.from), to: fmtDate(p.to), branchId: branch, rows: rows.length },
      }, meta);
      return { fileName: `${kind}-${fmtDate(p.from)}-${fmtDate(p.to)}.csv`, csv: csvRow(header) + rows.map(csvRow).join(''), rows: rows.length };
    });
  }

  // ---------------------------------------------------------------- internals

  private async expenseRows(tx: Tx, p: Period, branch: string | null) {
    const rows = await tx.expense.findMany({
      where: { occurredOn: { gte: p.from, lte: p.to }, ...(branch ? { branchId: branch } : {}) },
      include: { category: { select: { name: true } } },
      orderBy: [{ occurredOn: 'asc' }, { number: 'asc' }],
      take: MAX_EXPORT_ROWS + 1,
    });
    return {
      header: ['number', 'status', 'occurredOn', 'branchId', 'category', 'amountMinor', 'currency', 'description', 'reference', 'createdByUserId',
        'submittedAt', 'decidedByUserId', 'decidedAt', 'rejectionReason', 'voidedAt', 'voidReason', 'correctsExpenseId'],
      rows: rows.map((e) => [e.number, e.status, fmtDate(e.occurredOn), e.branchId, e.category.name, e.amountMinor, e.currency, e.description, e.reference,
        e.createdByUserId, e.submittedAt?.toISOString(), e.decidedByUserId, e.decidedAt?.toISOString(), e.rejectionReason, e.voidedAt?.toISOString(), e.voidReason,
        e.correctsExpenseId]),
    };
  }

  private async cashRows(tx: Tx, p: Period, branch: string | null) {
    const rows = await tx.cashMovement.findMany({
      where: { createdAt: { gte: p.from, lt: p.end }, ...(branch ? { branchId: branch } : {}) },
      orderBy: [{ createdAt: 'asc' }, { number: 'asc' }],
      take: MAX_EXPORT_ROWS + 1,
    });
    return {
      header: ['number', 'createdAt', 'branchId', 'sessionId', 'type', 'direction', 'amountMinor', 'currency', 'reason', 'reference', 'recordedByUserId', 'reversesId', 'verification'],
      rows: rows.map((m) => [m.number, m.createdAt.toISOString(), m.branchId, m.sessionId, m.type, m.direction, m.amountMinor, m.currency, m.reason, m.reference,
        m.recordedByUserId, m.reversesId, 'RECORDED']),
    };
  }

  private async assertBranch(tx: Tx, branchId: string) {
    if (!(await tx.branch.findUnique({ where: { id: branchId }, select: { id: true } }))) throw Errors.notFound('Branch');
  }
}
