import { HttpException } from '@nestjs/common';
import { assertCanDelegate, missingForDelegation } from './delegation';
import type { EffectiveAccess } from './permission-evaluator';

const actor = (partial: Partial<EffectiveAccess>): EffectiveAccess => ({
  userId: 'u', organizationId: 'o', membershipId: 'm', isOwner: false, grants: [], denies: [], ...partial,
});

describe('delegation (anti-escalation)', () => {
  it('owners may delegate anything registered', () => {
    expect(missingForDelegation(actor({ isOwner: true }), ['hr.payroll.approve'], null)).toEqual([]);
  });

  it('non-owners may only delegate what they hold', () => {
    const a = actor({ grants: [{ permission: 'inventory.product.read', branchId: null }] });
    expect(missingForDelegation(a, ['inventory.product.read', 'hr.payroll.approve'], null)).toEqual(['hr.payroll.approve']);
    expect(() => assertCanDelegate(a, ['hr.payroll.approve'])).toThrow(HttpException);
  });

  it('a branch-only holder may delegate at that branch but not organization-wide', () => {
    const a = actor({ grants: [{ permission: 'inventory.stock.adjust', branchId: 'b1' }] });
    expect(missingForDelegation(a, ['inventory.stock.adjust'], 'b1')).toEqual([]);
    expect(missingForDelegation(a, ['inventory.stock.adjust'], 'b2')).toEqual(['inventory.stock.adjust']);
    expect(missingForDelegation(a, ['inventory.stock.adjust'], null)).toEqual(['inventory.stock.adjust']);
  });

  it('treats unknown keys as missing', () => {
    expect(missingForDelegation(actor({ isOwner: false }), ['made.up.key'], null)).toEqual(['made.up.key']);
  });

  it('a denied permission cannot be delegated', () => {
    const a = actor({
      grants: [{ permission: 'sales.sale.refund', branchId: null }],
      denies: [{ permission: 'sales.sale.refund', branchId: null }],
    });
    expect(missingForDelegation(a, ['sales.sale.refund'], null)).toEqual(['sales.sale.refund']);
  });
});
