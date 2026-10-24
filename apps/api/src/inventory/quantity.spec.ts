import { escapeLike } from '../common/cursor';
import { ApiError } from '../common/errors';
import { Prisma } from '../generated/prisma/client';
import { lineTotalMinor, parseMinor, parseQuantity, scaleOfUnit } from './quantity';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return ((e as ApiError).getResponse() as { code: string }).code;
  }
  return 'ok';
};

describe('quantities, units and money', () => {
  it('units define their precision; unknown units are refused', () => {
    expect(scaleOfUnit('each')).toBe(0);
    expect(scaleOfUnit('kg')).toBe(3);
    expect(code(() => scaleOfUnit('furlong'))).toBe('invalid_unit');
  });

  it.each([
    ['1', 0, 'positive', 'ok'],
    ['1.5', 0, 'positive', 'invalid_quantity_precision'],
    ['1.250', 3, 'positive', 'ok'],
    ['1.2345', 3, 'positive', 'invalid_quantity'],
    ['0', 3, 'positive', 'invalid_quantity'],
    ['-1', 0, 'positive', 'invalid_quantity'],
    ['0', 0, 'nonnegative', 'ok'],
    ['-0.5', 3, 'nonnegative', 'invalid_quantity'],
    ['-2', 0, 'nonzero', 'ok'],
    ['0.000', 3, 'nonzero', 'zero_quantity'],
    ['1e3', 3, 'positive', 'invalid_quantity'],
    ['0x10', 3, 'positive', 'invalid_quantity'],
    [' 1', 3, 'positive', 'invalid_quantity'],
    ['1234567890123456', 0, 'positive', 'invalid_quantity'],
  ] as const)('parseQuantity(%s, scale %d, %s) -> %s', (raw, scale, sign, expected) => {
    expect(code(() => parseQuantity(raw, scale, sign))).toBe(expected);
  });

  it('money is non-negative integer minor units, bounded', () => {
    expect(parseMinor('1250', 'x')).toBe(1250n);
    expect(parseMinor(0, 'x')).toBe(0n);
    expect(parseMinor(null, 'x')).toBeNull();
    expect(code(() => parseMinor('12.50', 'x'))).toBe('invalid_amount');
    expect(code(() => parseMinor('-1', 'x'))).toBe('invalid_amount');
    expect(code(() => parseMinor('1000000000000001', 'x'))).toBe('invalid_amount');
    expect(code(() => parseMinor(1.5, 'x'))).toBe('invalid_amount');
  });

  it('line totals round half-up on exact decimals (matching PostgreSQL round())', () => {
    expect(lineTotalMinor(new Prisma.Decimal('3'), 333n)).toBe(999n);
    expect(lineTotalMinor(new Prisma.Decimal('0.5'), 1n)).toBe(1n); // 0.5 -> 1
    expect(lineTotalMinor(new Prisma.Decimal('0.499'), 1n)).toBe(0n);
    expect(lineTotalMinor(new Prisma.Decimal('2.125'), 1000n)).toBe(2125n);
    expect(lineTotalMinor(new Prisma.Decimal('0.333'), 3n)).toBe(1n); // 0.999 -> 1
    // Values far beyond floating-point precision stay exact.
    expect(lineTotalMinor(new Prisma.Decimal('999999999999.999'), 999999n)).toBe(999998999999999000n); // exactly 999998999999999000.001
  });

  it('search input is escaped so LIKE metacharacters match literally', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
    expect(escapeLike("o'brien \"x\" é")).toBe("o'brien \"x\" é");
  });
});
