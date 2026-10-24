import { Errors } from '../common/errors';
import { Prisma } from '../generated/prisma/client';

/**
 * Units of measure and the decimal places their quantities may use (docs/architecture/
 * 11-inventory-purchasing.md §2). Whole-unit items cannot be counted in fractions.
 */
export const UNITS: Readonly<Record<string, number>> = {
  each: 0, piece: 0, pair: 0, dozen: 0, pack: 0, box: 0, carton: 0, bag: 0, bottle: 0, roll: 0,
  kg: 3, g: 0, tonne: 3, l: 3, ml: 0, m: 3, cm: 0, m2: 3, m3: 3,
};

export function scaleOfUnit(unit: string): number {
  const scale = UNITS[unit];
  if (scale === undefined) throw Errors.badRequest('invalid_unit', `Unknown unit "${unit}". Allowed: ${Object.keys(UNITS).join(', ')}`);
  return scale;
}

/** Quantities travel as decimal strings (never floating point): up to 15 integer digits and 3 decimals. */
export const QUANTITY_PATTERN = /^-?\d{1,15}(\.\d{1,3})?$/;

/**
 * Parses and validates a quantity against the product's unit precision.
 * `sign`: 'positive' (> 0), 'nonnegative' (>= 0) or 'nonzero' (signed, ≠ 0).
 */
export function parseQuantity(raw: string, scale: number, sign: 'positive' | 'nonnegative' | 'nonzero', field = 'quantity'): Prisma.Decimal {
  if (!QUANTITY_PATTERN.test(raw)) throw Errors.badRequest('invalid_quantity', `${field} must be a decimal string with at most 3 decimals`);
  const q = new Prisma.Decimal(raw);
  if (q.decimalPlaces() > scale) {
    throw Errors.badRequest('invalid_quantity_precision', `${field} allows ${scale} decimal place(s) for this product's unit`);
  }
  if (sign === 'positive' && !q.greaterThan(0)) throw Errors.badRequest('invalid_quantity', `${field} must be greater than zero`);
  if (sign === 'nonnegative' && q.isNegative()) throw Errors.badRequest('invalid_quantity', `${field} must not be negative`);
  if (sign === 'nonzero' && q.isZero()) throw Errors.badRequest('zero_quantity', `${field} must not be zero`);
  return q;
}

/** Money is integer minor units. Accepts a non-negative integer string or number (≤ 10^15). */
export const MONEY_PATTERN = /^\d{1,16}$/;
export const MAX_MINOR = 10n ** 15n;

export function parseMinor(raw: string | number | null | undefined, field: string): bigint | null {
  if (raw === null || raw === undefined) return null;
  const s = typeof raw === 'number' ? (Number.isSafeInteger(raw) ? String(raw) : '') : raw;
  if (!MONEY_PATTERN.test(s)) throw Errors.badRequest('invalid_amount', `${field} must be a non-negative integer amount in minor units`);
  const v = BigInt(s);
  if (v > MAX_MINOR) throw Errors.badRequest('invalid_amount', `${field} is too large`);
  return v;
}

/**
 * quantity × unit cost, rounded half-up to whole minor units. Identical to PostgreSQL's
 * round(numeric) for non-negative values, which the line_total CHECK constraint uses.
 */
export function lineTotalMinor(quantity: Prisma.Decimal, unitCostMinor: bigint): bigint {
  const total = quantity.mul(new Prisma.Decimal(unitCostMinor.toString())).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  return BigInt(total.toFixed(0));
}

export const fmtQty = (d: Prisma.Decimal | string) => new Prisma.Decimal(d).toFixed(3);
export const fmtMinor = (v: bigint | null | undefined) => (v === null || v === undefined ? null : v.toString());
