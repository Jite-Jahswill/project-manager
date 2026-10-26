import type { Tx } from '../database/tenant-db.service';

/**
 * Cash a cashier session's drawer should hold: opening float + confirmed cash payments − cash
 * refunds recorded in the session + operational cash put into it − cash taken out of it
 * (finance cash movements linked to the session, reversals with their own direction).
 * The single definition used for closing a session and for refusing payouts that would take the
 * drawer below zero (docs/architecture/12-sales.md §12.2, 13-finance.md §3).
 */
export async function sessionExpectedCash(tx: Tx, sessionId: string, float: bigint): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ paid: string | null; refunded: string | null; cash_in: string | null; cash_out: string | null }[]>`
    SELECT (SELECT sum(amount_minor) FROM payments WHERE session_id = ${sessionId}::uuid AND method = 'CASH' AND status = 'CONFIRMED')::text AS paid,
           (SELECT sum(amount_minor) FROM refunds WHERE session_id = ${sessionId}::uuid AND method = 'CASH')::text AS refunded,
           (SELECT sum(amount_minor) FROM cash_movements WHERE session_id = ${sessionId}::uuid AND direction = 'IN')::text AS cash_in,
           (SELECT sum(amount_minor) FROM cash_movements WHERE session_id = ${sessionId}::uuid AND direction = 'OUT')::text AS cash_out`;
  return float + BigInt(row?.paid ?? '0') - BigInt(row?.refunded ?? '0') + BigInt(row?.cash_in ?? '0') - BigInt(row?.cash_out ?? '0');
}
