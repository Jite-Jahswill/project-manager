import { branchesWith, can, EffectiveAccess, effectivePermissionKeys, notAppliedAtBranch } from './permission-evaluator';
import { ROLE_TEMPLATES } from './role-templates';
import { PERMISSIONS } from './permission-registry';

const B1 = 'branch-1';
const B2 = 'branch-2';

function access(partial: Partial<EffectiveAccess>): EffectiveAccess {
  return { userId: 'u', organizationId: 'o', membershipId: 'm', isOwner: false, grants: [], denies: [], ...partial };
}

describe('permission evaluator', () => {
  it('denies unknown permission keys, even for owners', () => {
    expect(can(access({ isOwner: true }), 'inventory.product.destroy_everything')).toBe(false);
  });

  it('grants every registered permission to owners', () => {
    const owner = access({ isOwner: true });
    for (const key of PERMISSIONS.keys()) expect(can(owner, key)).toBe(true);
  });

  it('denies by default', () => {
    expect(can(access({}), 'inventory.product.read')).toBe(false);
  });

  it('an organization-wide grant of a branch permission covers every branch', () => {
    const a = access({ grants: [{ permission: 'inventory.stock.adjust', branchId: null }] });
    expect(can(a, 'inventory.stock.adjust', B1)).toBe(true);
    expect(can(a, 'inventory.stock.adjust', B2)).toBe(true);
    expect(branchesWith(a, 'inventory.stock.adjust')).toBe('ALL');
  });

  it('a branch grant covers only that branch, and not "all branches"', () => {
    const a = access({ grants: [{ permission: 'inventory.stock.adjust', branchId: B1 }] });
    expect(can(a, 'inventory.stock.adjust', B1)).toBe(true);
    expect(can(a, 'inventory.stock.adjust', B2)).toBe(false);
    expect(can(a, 'inventory.stock.adjust')).toBe(false);
    expect(branchesWith(a, 'inventory.stock.adjust')).toEqual([B1]);
  });

  it('a branch-attached grant of an organization-scoped permission grants nothing', () => {
    const a = access({ grants: [{ permission: 'organization.member.manage', branchId: B1 }] });
    expect(can(a, 'organization.member.manage')).toBe(false);
    expect(can(a, 'organization.member.manage', B1)).toBe(false);
  });

  it('DENY beats GRANT at the same or wider scope', () => {
    const wide = access({
      grants: [{ permission: 'sales.sale.refund', branchId: null }],
      denies: [{ permission: 'sales.sale.refund', branchId: null }],
    });
    expect(can(wide, 'sales.sale.refund', B1)).toBe(false);
    const narrow = access({
      grants: [{ permission: 'sales.sale.refund', branchId: null }],
      denies: [{ permission: 'sales.sale.refund', branchId: B2 }],
    });
    expect(can(narrow, 'sales.sale.refund', B1)).toBe(true);
    expect(can(narrow, 'sales.sale.refund', B2)).toBe(false);
    expect(branchesWith(narrow, 'sales.sale.refund')).toBe('ALL');
  });
});

describe('role templates', () => {
  it('only reference registered permissions', () => {
    for (const t of ROLE_TEMPLATES) for (const p of t.permissions) expect(PERMISSIONS.has(p)).toBe(true);
  });

  it('keep payroll approval separate from payroll preparation', () => {
    for (const t of ROLE_TEMPLATES) {
      expect({ role: t.key, both: t.permissions.includes('hr.payroll.prepare') && t.permissions.includes('hr.payroll.approve') })
        .toEqual({ role: t.key, both: false });
    }
  });

  it('never give cashiers, sales reps or viewers restricted permissions', () => {
    for (const key of ['cashier', 'sales_rep', 'viewer', 'storekeeper']) {
      const t = ROLE_TEMPLATES.find((r) => r.key === key)!;
      expect(t.permissions.filter((p) => PERMISSIONS.get(p)!.sensitivity === 'RESTRICTED')).toEqual([]);
    }
  });
});

describe('branch-limited assignments', () => {
  it('confer branch-assignable catalog reads but never organization administration', () => {
    const a = access({ grants: [
      { permission: 'inventory.product.read', branchId: B1 },
      { permission: 'organization.member.manage', branchId: B1 },
      { permission: 'organization.role.manage', branchId: B1 },
    ] });
    expect(can(a, 'inventory.product.read')).toBe(true);
    expect(can(a, 'organization.member.manage')).toBe(false);
    expect(can(a, 'organization.role.manage')).toBe(false);
    expect(notAppliedAtBranch(['inventory.product.read', 'organization.member.manage', 'inventory.stock.read'])).toEqual(['organization.member.manage']);
  });

  it('only non-sensitive organization-scoped reads are branch-assignable', () => {
    for (const def of PERMISSIONS.values()) {
      if (!def.branchAssignable) continue;
      expect({ key: def.key, scope: def.scope, sensitivity: def.sensitivity, action: def.key.split('.')[2] })
        .toEqual({ key: def.key, scope: 'ORGANIZATION', sensitivity: 'STANDARD', action: 'read' });
    }
  });
});

describe('UI permission hints match enforcement', () => {
  const keys = [...PERMISSIONS.keys()];
  const branches = [B1, B2, null];
  // Deterministic pseudo-random access states.
  let seed = 42;
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
  const entry = () => ({ permission: keys[rnd(keys.length)], branchId: branches[rnd(3)] });

  it('every permission shown to the client is honoured by can(), and nothing honoured is hidden', () => {
    for (let i = 0; i < 500; i++) {
      const a = access({
        grants: Array.from({ length: rnd(12) }, entry),
        denies: Array.from({ length: rnd(4) }, entry),
      });
      const shown = effectivePermissionKeys(a);
      for (const k of keys) expect(shown.organizationWide.includes(k)).toBe(can(a, k));
      for (const b of [B1, B2]) {
        for (const k of keys) {
          const visible = shown.organizationWide.includes(k) || (shown.byBranch[b] ?? []).includes(k);
          if (PERMISSIONS.get(k)!.scope === 'BRANCH') expect({ k, b, visible }).toEqual({ k, b, visible: can(a, k, b) });
          else expect({ k, b, visible }).toEqual({ k, b, visible: can(a, k) });
        }
      }
    }
  });
});
