import { ApiError } from '../common/errors';
import { cleanReference, csvField, csvRow, optionalPeriod, parseDate, parseOccurredOn, parsePeriod, positiveAmount } from './finance-common';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return ((e as ApiError).getResponse() as { code: string }).code;
  }
  return 'ok';
};

describe('finance dates and periods', () => {
  it('parses real calendar dates only (no silent roll-over)', () => {
    expect(parseDate('2026-02-28', 'd').toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(parseDate('2028-02-29', 'd').toISOString()).toBe('2028-02-29T00:00:00.000Z');
    for (const bad of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-1-1', '26-01-01', '2026-01-01T00:00', '1999-12-31', '']) {
      expect({ bad, code: code(() => parseDate(bad, 'd')) }).toEqual({ bad, code: 'invalid_date' });
    }
  });

  it('periods are inclusive UTC days, ordered, at most 366 days', () => {
    const p = parsePeriod('2026-10-01', '2026-10-31');
    expect([p.from.toISOString(), p.to.toISOString(), p.end.toISOString()]).toEqual([
      '2026-10-01T00:00:00.000Z', '2026-10-31T00:00:00.000Z', '2026-11-01T00:00:00.000Z',
    ]);
    expect(parsePeriod('2026-10-05', '2026-10-05').end.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(code(() => parsePeriod('2026-10-02', '2026-10-01'))).toBe('invalid_period');
    expect(code(() => parsePeriod('2025-01-01', '2026-01-01'))).toBe('ok'); // 366 days
    expect(code(() => parsePeriod('2025-01-01', '2026-01-02'))).toBe('period_too_long');
    expect(optionalPeriod(undefined, undefined)).toBeNull();
    expect(code(() => optionalPeriod('2026-01-01', undefined))).toBe('invalid_period');
  });

  it('expense dates may not be in the future (one day of slack for zones ahead of UTC)', () => {
    const now = new Date('2026-10-26T12:00:00Z');
    expect(code(() => parseOccurredOn('2026-10-27', now))).toBe('ok');
    expect(code(() => parseOccurredOn('2026-10-28', now))).toBe('invalid_date');
    expect(code(() => parseOccurredOn('2001-05-05', now))).toBe('ok');
  });
});

describe('finance amounts and references', () => {
  it('amounts are positive integer minor units within bounds', () => {
    expect(positiveAmount('1', 'a')).toBe(1n);
    expect(positiveAmount('1000000000000000', 'a')).toBe(10n ** 15n);
    for (const bad of ['0', '-5', '1.5', '1e3', '', ' 12', '10000000000000001']) {
      expect({ bad, code: code(() => positiveAmount(bad, 'a')) }).toEqual({ bad, code: 'invalid_amount' });
    }
  });

  it('references are trimmed, optional, and never card numbers', () => {
    expect(cleanReference('  INV-2026-0042 ')).toBe('INV-2026-0042');
    expect(cleanReference('   ')).toBeNull();
    expect(cleanReference(undefined)).toBeNull();
    expect(code(() => cleanReference('card 4111111111111111'))).toBe('card_data_refused');
  });
});

describe('CSV export cells', () => {
  it('quotes separators and neutralizes spreadsheet formulas', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    for (const f of ['=HYPERLINK("x")', '+1', '-1+2', '@SUM(A1)', '\tx']) expect(csvField(f).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvField(1250n)).toBe('1250');
    expect(csvField(null)).toBe('');
    expect(csvRow(['E-000001', 1250n, null, 'x'])).toBe('E-000001,1250,,x\r\n');
  });
});
