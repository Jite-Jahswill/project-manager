import { ALL_PERMISSION_KEYS, PermissionKey } from './permission-registry';

/**
 * Starter roles copied into every new organization. After creation they are
 * ordinary, editable roles owned by that organization (identified by templateKey).
 *
 * Templates are versioned (role-template-history.ts). Changing one here requires a new
 * history snapshot; `pnpm api db:seed` then grants existing organizations' template roles
 * only what the new version ADDED, never what an organization explicitly removed, and
 * never removes anything (role-template-sync.ts).
 *
 * The Owner role is the exception: it is a locked system role whose holders have
 * every permission (see permission-evaluator.ts), so it stores no permission rows.
 */
export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

export const OWNER_TEMPLATE_KEY = 'owner';

const except = (...excluded: PermissionKey[]) => ALL_PERMISSION_KEYS.filter((k) => !excluded.includes(k));

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    key: 'org_admin',
    name: 'Organization administrator',
    description: 'Runs the organization day to day. No payroll approval or sensitive HR data by default.',
    // Self-approval of purchases is a restricted exception, not part of day-to-day administration.
    permissions: except('hr.employee.read_sensitive', 'hr.payroll.approve', 'hr.payroll.export', 'hr.payroll.prepare', 'purchasing.order.self_approve'),
  },
  {
    key: 'branch_manager',
    name: 'Branch manager',
    description: 'Manages operations of the branches they are assigned to.',
    permissions: [
      'organization.branch.read', 'organization.member.read',
      'inventory.product.read', 'inventory.stock.read', 'inventory.stock.adjust', 'inventory.stock.transfer',
      'inventory.stock.approve_adjustment', 'inventory.stock.count',
      'purchasing.supplier.read', 'purchasing.order.read', 'purchasing.order.create', 'purchasing.order.submit',
      'purchasing.order.approve', 'purchasing.order.receive', 'purchasing.return.create',
      'sales.sale.read', 'sales.sale.create', 'sales.sale.refund', 'sales.payment.confirm', 'sales.customer.read',
      'sales.sale.void', 'sales.session.manage', 'sales.session.supervise', 'sales.return.accept', 'sales.return.restock',
      'logistics.shipment.read', 'finance.expense.create', 'hr.employee.read', 'reports.operational.read',
    ],
  },
  {
    key: 'inventory_manager',
    name: 'Inventory manager',
    description: 'Owns the product catalog and stock control.',
    permissions: [
      'organization.branch.read',
      'inventory.product.read', 'inventory.product.create', 'inventory.product.update', 'inventory.product.archive',
      'inventory.stock.read', 'inventory.stock.adjust', 'inventory.stock.transfer', 'inventory.stock.approve_adjustment',
      'inventory.stock.count', 'inventory.category.manage', 'inventory.cost.read',
      'purchasing.supplier.read', 'purchasing.supplier.manage', 'purchasing.order.read', 'purchasing.order.create',
      'purchasing.order.submit', 'purchasing.order.receive', 'purchasing.return.create', 'purchasing.report.read',
      'reports.operational.read',
    ],
  },
  {
    key: 'storekeeper',
    name: 'Storekeeper',
    description: 'Counts, receives and adjusts stock at assigned branches. Adjustments may require approval.',
    permissions: ['inventory.product.read', 'inventory.stock.read', 'inventory.stock.adjust', 'inventory.stock.count', 'purchasing.order.read', 'purchasing.order.receive'],
  },
  {
    key: 'cashier',
    name: 'Cashier',
    description: 'Records sales and payments at assigned branches.',
    permissions: [
      'inventory.product.read', 'inventory.stock.read', 'sales.sale.create', 'sales.sale.read', 'sales.payment.confirm', 'sales.customer.read',
      'sales.session.manage', 'sales.return.accept',
    ],
  },
  {
    key: 'sales_rep',
    name: 'Sales representative',
    description: 'Sells and manages customer relationships.',
    permissions: ['inventory.product.read', 'inventory.stock.read', 'sales.sale.create', 'sales.sale.read', 'sales.customer.read', 'sales.customer.manage', 'sales.session.manage'],
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Financial reporting, expenses and reconciliation.',
    permissions: [
      'organization.branch.read', 'sales.sale.read', 'finance.report.read', 'finance.expense.create',
      'finance.expense.approve', 'finance.ledger.reconcile', 'reports.operational.read',
      'inventory.product.read', 'inventory.cost.read', 'purchasing.supplier.read', 'purchasing.order.read', 'purchasing.report.read',
      'sales.report.read',
    ],
  },
  {
    key: 'hr_manager',
    name: 'HR manager',
    description: 'Employee records including sensitive HR data. No payroll approval by default.',
    permissions: ['organization.member.read', 'hr.employee.read', 'hr.employee.read_sensitive', 'hr.employee.manage', 'hr.payroll.read'],
  },
  {
    key: 'payroll_officer',
    name: 'Payroll officer',
    description: 'Prepares payroll. Approval is a separate permission (separation of duties).',
    permissions: ['hr.employee.read', 'hr.employee.read_sensitive', 'hr.payroll.read', 'hr.payroll.prepare'],
  },
  {
    key: 'auditor',
    name: 'Auditor',
    description: 'Read-only access including financial reports and the audit log.',
    permissions: [
      'organization.settings.read', 'organization.branch.read', 'organization.member.read', 'organization.role.read',
      'security.audit.read', 'inventory.product.read', 'inventory.stock.read', 'sales.sale.read', 'finance.report.read',
      'reports.operational.read', 'inventory.cost.read', 'purchasing.supplier.read', 'purchasing.order.read', 'purchasing.report.read',
      'sales.report.read',
    ],
  },
  {
    key: 'logistics_officer',
    name: 'Logistics officer',
    description: 'Dispatches and tracks shipments.',
    permissions: ['inventory.product.read', 'inventory.stock.read', 'inventory.stock.transfer', 'logistics.shipment.read', 'logistics.shipment.manage'],
  },
  {
    key: 'viewer',
    name: 'Read-only viewer',
    description: 'Views non-sensitive operational data.',
    permissions: ['organization.branch.read', 'inventory.product.read', 'inventory.stock.read', 'sales.sale.read', 'reports.operational.read'],
  },
];
