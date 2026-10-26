import { Errors } from '../common/errors';
import { parseMinor } from '../inventory/quantity';

/** The longest period a summary, listing filter or export may cover. */
export const MAX_PERIOD_DAYS = 366;
/** Exports refuse (rather than truncate) a result larger than this. */
export const MAX_EXPORT_ROWS = 10_000;
const DAY_MS = 86_400_000;

/** 13-19 consecutive digits look like a card number: never stored (the database CHECKs agree). */
const CARD_LIKE = /[0-9]{13,19}/;

/**
 * A calendar date (YYYY-MM-DD) as UTC midnight. Rejects impossible dates such as 2026-02-30,
 * which `new Date()` would silently roll over.
 */
export function parseDate(raw: string, field: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || !d || d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw Errors.badRequest('invalid_date', `${field} must be a valid date (YYYY-MM-DD)`);
  }
  if (d.getUTCFullYear() < 2000) throw Errors.badRequest('invalid_date', `${field} must not be before 2000-01-01`);
  return d;
}

export const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

export function todayUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Expense business dates may not be in the future (one day of slack for time zones ahead of UTC). */
export function parseOccurredOn(raw: string, now = new Date()): Date {
  const d = parseDate(raw, 'occurredOn');
  if (d.getTime() > todayUtc(now).getTime() + DAY_MS) throw Errors.badRequest('invalid_date', 'occurredOn must not be in the future');
  return d;
}

export interface Period {
  from: Date;
  to: Date;
  /** Exclusive upper bound for timestamps: the UTC midnight after `to`. */
  end: Date;
}

/** An inclusive [from, to] range of UTC calendar days, at most MAX_PERIOD_DAYS long. */
export function parsePeriod(fromRaw: string, toRaw: string): Period {
  const from = parseDate(fromRaw, 'from');
  const to = parseDate(toRaw, 'to');
  if (to < from) throw Errors.badRequest('invalid_period', '`to` must not be before `from`');
  if ((to.getTime() - from.getTime()) / DAY_MS + 1 > MAX_PERIOD_DAYS) {
    throw Errors.badRequest('period_too_long', `A period may cover at most ${MAX_PERIOD_DAYS} days`);
  }
  return { from, to, end: new Date(to.getTime() + DAY_MS) };
}

/** Both bounds or neither: an open-ended filter is allowed on listings, a half-open one is not. */
export function optionalPeriod(from: string | undefined, to: string | undefined): Period | null {
  if (from === undefined && to === undefined) return null;
  if (from === undefined || to === undefined) throw Errors.badRequest('invalid_period', 'Send both `from` and `to`, or neither');
  return parsePeriod(from, to);
}

export function positiveAmount(raw: string, field: string): bigint {
  const v = parseMinor(raw, field)!;
  if (v <= 0n) throw Errors.badRequest('invalid_amount', `${field} must be greater than zero`);
  return v;
}

export function cleanReference(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (CARD_LIKE.test(v)) throw Errors.badRequest('card_data_refused', 'References must not contain card numbers');
  return v;
}

/**
 * One CSV field (RFC 4180). Cells a spreadsheet would evaluate as a formula (=, +, -, @, tab,
 * carriage return) are prefixed with an apostrophe, so an export cannot run code when opened.
 */
export function csvField(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: readonly (string | number | bigint | null | undefined)[]) => cells.map(csvField).join(',') + '\r\n';
