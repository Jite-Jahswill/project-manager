import { ApiError } from '../common/errors';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import { customerScope, normalizeCustomerEmail, normalizePhone } from './customers.service';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return ((e as ApiError).getResponse() as { code: string }).code;
  }
  return 'ok';
};

const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';
const access = (over: Partial<EffectiveAccess>): EffectiveAccess => ({
  userId: 'u', organizationId: 'o', membershipId: 'm', isOwner: false, grants: [], denies: [], ...over,
});
const read = (branchId: string | null) => ({ permission: 'sales.customer.read', branchId });

describe('customer contact normalization', () => {
  it('reduces phone numbers to digits with an optional leading +', () => {
    expect(normalizePhone(' +234 (803) 000-0001 ')).toBe('+2348030000001');
    expect(normalizePhone('0803.000.0001')).toBe('08030000001');
    expect(code(() => normalizePhone('12345'))).toBe('invalid_phone');
    expect(code(() => normalizePhone('+1234567890123456'))).toBe('invalid_phone');
  });

  it('compares emails case-insensitively', () => {
    expect(normalizeCustomerEmail('  Ada@Example.TEST ')).toBe('ada@example.test');
  });
});

describe('customer visibility scope', () => {
  it('owners and organization-wide grants see every customer', () => {
    expect(customerScope(access({ isOwner: true }))).toBe('ALL');
    expect(customerScope(access({ grants: [read(null), read(B1)] }))).toBe('ALL');
  });

  it('branch-limited grants see only their branches; denies remove branches or everything', () => {
    expect(customerScope(access({ grants: [read(B1), read(B2), read(B1)] }))).toEqual([B1, B2]);
    expect(customerScope(access({ grants: [read(B1), read(B2)], denies: [read(B2)] }))).toEqual([B1]);
    expect(customerScope(access({ grants: [read(null)], denies: [read(null)] }))).toEqual([]);
    expect(customerScope(access({ grants: [{ permission: 'sales.sale.read', branchId: null }] }))).toEqual([]);
  });
});
