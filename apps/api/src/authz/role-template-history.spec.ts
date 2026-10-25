import { PERMISSIONS } from './permission-registry';
import { PLATFORM_PERMISSIONS } from './platform-permission-registry';
import { LEGACY_TEMPLATE_VERSION, ROLE_TEMPLATE_HISTORY, ROLE_TEMPLATE_VERSION, templateSnapshot } from './role-template-history';
import { planRoleUpgrade } from './role-template-sync';
import { ROLE_TEMPLATES } from './role-templates';

const none = new Set<string>();
const plan = (templateKey: string, templateVersion: number | null, current: readonly string[], removed: ReadonlySet<string> = none) =>
  planRoleUpgrade({ templateKey, templateVersion, current, excluded: removed });
const v = (version: number, key: string) => [...(templateSnapshot(version)?.templates[key] ?? [])];

describe('role template history', () => {
  it('the newest snapshot is exactly ROLE_TEMPLATES (edit a template => append a version)', () => {
    const current = Object.fromEntries(ROLE_TEMPLATES.map((t) => [t.key, [...t.permissions].sort()]));
    expect(templateSnapshot(ROLE_TEMPLATE_VERSION)?.templates).toEqual(current);
  });

  it('versions run 1..N without gaps, and the legacy baseline is version 1', () => {
    expect(ROLE_TEMPLATE_HISTORY.map((s) => s.version)).toEqual(ROLE_TEMPLATE_HISTORY.map((_, i) => i + 1));
    expect(ROLE_TEMPLATE_VERSION).toBe(3);
    expect(LEGACY_TEMPLATE_VERSION).toBe(1);
  });

  it('snapshots are sorted, duplicate-free and contain organization permissions only', () => {
    for (const s of ROLE_TEMPLATE_HISTORY) {
      for (const [key, perms] of Object.entries(s.templates)) {
        expect({ v: s.version, key, perms }).toEqual({ v: s.version, key, perms: [...new Set(perms)].sort() });
        for (const p of perms) {
          expect({ v: s.version, key, p, org: PERMISSIONS.has(p), platform: PLATFORM_PERMISSIONS.has(p) })
            .toEqual({ v: s.version, key, p, org: true, platform: false });
        }
      }
    }
  });

  it('no version removed a permission from a template (the sync only adds; a removal needs its own design)', () => {
    for (let i = 1; i < ROLE_TEMPLATE_HISTORY.length; i++) {
      const [prev, next] = [ROLE_TEMPLATE_HISTORY[i - 1], ROLE_TEMPLATE_HISTORY[i]];
      for (const [key, perms] of Object.entries(prev.templates)) {
        expect({ key, version: next.version, dropped: perms.filter((p) => !next.templates[key]?.includes(p)) })
          .toEqual({ key, version: next.version, dropped: [] });
      }
    }
  });

  it('no version gives elevated privileges to roles that must not have them', () => {
    for (const s of ROLE_TEMPLATE_HISTORY) {
      for (const p of ['purchasing.order.self_approve', 'hr.employee.read_sensitive', 'hr.payroll.approve', 'hr.payroll.export', 'hr.payroll.prepare']) {
        expect({ v: s.version, orgAdminHas: p, yes: s.templates.org_admin.includes(p) }).toEqual({ v: s.version, orgAdminHas: p, yes: false });
      }
      for (const p of ['sales.sale.refund', 'sales.sale.void', 'inventory.cost.read', 'purchasing.order.approve', 'purchasing.order.self_approve',
        'inventory.stock.approve_adjustment', 'sales.session.supervise', 'sales.return.restock', 'sales.report.read']) {
        expect({ v: s.version, cashierHas: p, yes: s.templates.cashier.includes(p) }).toEqual({ v: s.version, cashierHas: p, yes: false });
      }
    }
  });
});

describe('planRoleUpgrade', () => {
  it('a legacy (v1) cashier receives exactly what v2 and v3 added: open a session, accept returns', () => {
    expect(plan('cashier', null, v(1, 'cashier'))).toEqual({
      kind: 'upgrade', fromVersion: 1, toVersion: 3, add: ['sales.return.accept', 'sales.session.manage'], withheld: [],
    });
  });

  it('a legacy organization administrator gets the phase 4 and 5 additions but not self-approval', () => {
    const p = plan('org_admin', null, v(1, 'org_admin'));
    expect(p).toEqual({
      kind: 'upgrade', fromVersion: 1, toVersion: 3, withheld: [],
      add: [
        'inventory.category.manage', 'inventory.cost.read', 'inventory.stock.count', 'purchasing.order.read', 'purchasing.order.submit',
        'purchasing.report.read', 'purchasing.return.create', 'sales.report.read', 'sales.return.accept', 'sales.return.restock',
        'sales.sale.void', 'sales.session.manage', 'sales.session.supervise',
      ],
    });
  });

  it('a v2 role receives only the v3 additions', () => {
    expect(plan('accountant', 2, v(2, 'accountant'))).toEqual({ kind: 'upgrade', fromVersion: 2, toVersion: 3, add: ['sales.report.read'], withheld: [] });
    expect(plan('storekeeper', 2, v(2, 'storekeeper'))).toEqual({ kind: 'upgrade', fromVersion: 2, toVersion: 3, add: [], withheld: [] });
  });

  it('keeps customizations: extra permissions stay, permissions removed from the v1 template are not re-added', () => {
    const custom = v(1, 'cashier').filter((k) => k !== 'sales.customer.read').concat('sales.sale.refund');
    expect(plan('cashier', null, custom)).toEqual({
      kind: 'upgrade', fromVersion: 1, toVersion: 3, add: ['sales.return.accept', 'sales.session.manage'], withheld: [],
    });
  });

  it('withholds a newly introduced permission the organization excluded', () => {
    expect(plan('cashier', null, v(1, 'cashier'), new Set(['sales.session.manage']))).toEqual({
      kind: 'upgrade', fromVersion: 1, toVersion: 3, add: ['sales.return.accept'], withheld: ['sales.session.manage'],
    });
  });

  it('does not re-add what the role already holds', () => {
    expect(plan('cashier', null, v(3, 'cashier'))).toEqual({ kind: 'upgrade', fromVersion: 1, toVersion: 3, add: [], withheld: [] });
  });

  it('current, newer and unknown roles are left alone', () => {
    expect(plan('cashier', 3, [])).toEqual({ kind: 'current' });
    expect(plan('cashier', 4, [])).toEqual({ kind: 'ahead', templateVersion: 4 });
    expect(plan('retired_template', null, [])).toEqual({ kind: 'unknown_template' });
    expect(plan('owner', null, [])).toEqual({ kind: 'unknown_template' });
  });

  it('never grants a key outside the organization catalog, even if a template lists one', () => {
    const catalog = new Set(v(3, 'cashier').filter((k) => k !== 'sales.session.manage'));
    expect(planRoleUpgrade({ templateKey: 'cashier', templateVersion: 1, current: v(1, 'cashier'), excluded: none }, 3, catalog))
      .toEqual({ kind: 'upgrade', fromVersion: 1, toVersion: 3, add: ['sales.return.accept'], withheld: [] });
  });
});
