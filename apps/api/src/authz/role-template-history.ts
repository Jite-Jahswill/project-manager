/**
 * Frozen history of the organization role templates (role-templates.ts), one full snapshot
 * per template version. Generated from the templates as shipped in each version; NEVER edit
 * a published snapshot. To change a template: edit ROLE_TEMPLATES, append a new snapshot that
 * equals it and bump ROLE_TEMPLATE_VERSION (role-template-history.spec.ts enforces this).
 *
 * Existing organizations converge on a new version through syncRoleTemplates()
 * (role-template-sync.ts), which grants only what a version ADDED to a template.
 * See docs/architecture/10-organizations.md §10.6.
 */

export interface RoleTemplateSnapshot {
  version: number;
  /** What shipped this version. */
  introducedIn: string;
  /** Template key -> permission keys (sorted). Strings, not PermissionKey: history must outlive catalog edits. */
  templates: Readonly<Record<string, readonly string[]>>;
}

export const ROLE_TEMPLATE_HISTORY: readonly RoleTemplateSnapshot[] = [
  {
    version: 1,
    introducedIn: 'stage 1 to phase 3 (commits ff94238..3b929f5)',
    templates: {
      org_admin: [
        'finance.expense.approve', 'finance.expense.create', 'finance.ledger.reconcile', 'finance.report.read',
        'hr.employee.manage', 'hr.employee.read', 'hr.payroll.read', 'inventory.product.archive',
        'inventory.product.create', 'inventory.product.read', 'inventory.product.update', 'inventory.stock.adjust',
        'inventory.stock.approve_adjustment', 'inventory.stock.read', 'inventory.stock.transfer',
        'logistics.shipment.manage', 'logistics.shipment.read', 'organization.branch.manage',
        'organization.branch.read', 'organization.member.manage', 'organization.member.read',
        'organization.role.manage', 'organization.role.read', 'organization.settings.manage',
        'organization.settings.read', 'organization.subscription.read', 'purchasing.order.approve',
        'purchasing.order.create', 'purchasing.order.receive', 'purchasing.supplier.manage',
        'purchasing.supplier.read', 'reports.data.export', 'reports.operational.read', 'sales.customer.manage',
        'sales.customer.read', 'sales.payment.confirm', 'sales.sale.create', 'sales.sale.read', 'sales.sale.refund',
        'security.audit.read',
      ],
      branch_manager: [
        'finance.expense.create', 'hr.employee.read', 'inventory.product.read', 'inventory.stock.adjust',
        'inventory.stock.approve_adjustment', 'inventory.stock.read', 'inventory.stock.transfer',
        'logistics.shipment.read', 'organization.branch.read', 'organization.member.read',
        'purchasing.order.approve', 'purchasing.order.create', 'purchasing.order.receive',
        'purchasing.supplier.read', 'reports.operational.read', 'sales.customer.read', 'sales.payment.confirm',
        'sales.sale.create', 'sales.sale.read', 'sales.sale.refund',
      ],
      inventory_manager: [
        'inventory.product.archive', 'inventory.product.create', 'inventory.product.read',
        'inventory.product.update', 'inventory.stock.adjust', 'inventory.stock.approve_adjustment',
        'inventory.stock.read', 'inventory.stock.transfer', 'organization.branch.read', 'purchasing.order.create',
        'purchasing.order.receive', 'purchasing.supplier.manage', 'purchasing.supplier.read',
        'reports.operational.read',
      ],
      storekeeper: [
        'inventory.product.read', 'inventory.stock.adjust', 'inventory.stock.read', 'purchasing.order.receive',
      ],
      cashier: [
        'inventory.product.read', 'inventory.stock.read', 'sales.customer.read', 'sales.payment.confirm',
        'sales.sale.create', 'sales.sale.read',
      ],
      sales_rep: [
        'inventory.product.read', 'inventory.stock.read', 'sales.customer.manage', 'sales.customer.read',
        'sales.sale.create', 'sales.sale.read',
      ],
      accountant: [
        'finance.expense.approve', 'finance.expense.create', 'finance.ledger.reconcile', 'finance.report.read',
        'organization.branch.read', 'reports.operational.read', 'sales.sale.read',
      ],
      hr_manager: [
        'hr.employee.manage', 'hr.employee.read', 'hr.employee.read_sensitive', 'hr.payroll.read',
        'organization.member.read',
      ],
      payroll_officer: [
        'hr.employee.read', 'hr.employee.read_sensitive', 'hr.payroll.prepare', 'hr.payroll.read',
      ],
      auditor: [
        'finance.report.read', 'inventory.product.read', 'inventory.stock.read', 'organization.branch.read',
        'organization.member.read', 'organization.role.read', 'organization.settings.read',
        'reports.operational.read', 'sales.sale.read', 'security.audit.read',
      ],
      logistics_officer: [
        'inventory.product.read', 'inventory.stock.read', 'inventory.stock.transfer', 'logistics.shipment.manage',
        'logistics.shipment.read',
      ],
      viewer: [
        'inventory.product.read', 'inventory.stock.read', 'organization.branch.read', 'reports.operational.read',
        'sales.sale.read',
      ],
    },
  },
  {
    version: 2,
    introducedIn: 'phase 4, inventory and purchasing (3141b75)',
    templates: {
      org_admin: [
        'finance.expense.approve', 'finance.expense.create', 'finance.ledger.reconcile', 'finance.report.read',
        'hr.employee.manage', 'hr.employee.read', 'hr.payroll.read', 'inventory.category.manage',
        'inventory.cost.read', 'inventory.product.archive', 'inventory.product.create', 'inventory.product.read',
        'inventory.product.update', 'inventory.stock.adjust', 'inventory.stock.approve_adjustment',
        'inventory.stock.count', 'inventory.stock.read', 'inventory.stock.transfer', 'logistics.shipment.manage',
        'logistics.shipment.read', 'organization.branch.manage', 'organization.branch.read',
        'organization.member.manage', 'organization.member.read', 'organization.role.manage',
        'organization.role.read', 'organization.settings.manage', 'organization.settings.read',
        'organization.subscription.read', 'purchasing.order.approve', 'purchasing.order.create',
        'purchasing.order.read', 'purchasing.order.receive', 'purchasing.order.submit', 'purchasing.report.read',
        'purchasing.return.create', 'purchasing.supplier.manage', 'purchasing.supplier.read', 'reports.data.export',
        'reports.operational.read', 'sales.customer.manage', 'sales.customer.read', 'sales.payment.confirm',
        'sales.sale.create', 'sales.sale.read', 'sales.sale.refund', 'security.audit.read',
      ],
      branch_manager: [
        'finance.expense.create', 'hr.employee.read', 'inventory.product.read', 'inventory.stock.adjust',
        'inventory.stock.approve_adjustment', 'inventory.stock.count', 'inventory.stock.read',
        'inventory.stock.transfer', 'logistics.shipment.read', 'organization.branch.read',
        'organization.member.read', 'purchasing.order.approve', 'purchasing.order.create', 'purchasing.order.read',
        'purchasing.order.receive', 'purchasing.order.submit', 'purchasing.return.create',
        'purchasing.supplier.read', 'reports.operational.read', 'sales.customer.read', 'sales.payment.confirm',
        'sales.sale.create', 'sales.sale.read', 'sales.sale.refund',
      ],
      inventory_manager: [
        'inventory.category.manage', 'inventory.cost.read', 'inventory.product.archive', 'inventory.product.create',
        'inventory.product.read', 'inventory.product.update', 'inventory.stock.adjust',
        'inventory.stock.approve_adjustment', 'inventory.stock.count', 'inventory.stock.read',
        'inventory.stock.transfer', 'organization.branch.read', 'purchasing.order.create', 'purchasing.order.read',
        'purchasing.order.receive', 'purchasing.order.submit', 'purchasing.report.read', 'purchasing.return.create',
        'purchasing.supplier.manage', 'purchasing.supplier.read', 'reports.operational.read',
      ],
      storekeeper: [
        'inventory.product.read', 'inventory.stock.adjust', 'inventory.stock.count', 'inventory.stock.read',
        'purchasing.order.read', 'purchasing.order.receive',
      ],
      cashier: [
        'inventory.product.read', 'inventory.stock.read', 'sales.customer.read', 'sales.payment.confirm',
        'sales.sale.create', 'sales.sale.read',
      ],
      sales_rep: [
        'inventory.product.read', 'inventory.stock.read', 'sales.customer.manage', 'sales.customer.read',
        'sales.sale.create', 'sales.sale.read',
      ],
      accountant: [
        'finance.expense.approve', 'finance.expense.create', 'finance.ledger.reconcile', 'finance.report.read',
        'inventory.cost.read', 'inventory.product.read', 'organization.branch.read', 'purchasing.order.read',
        'purchasing.report.read', 'purchasing.supplier.read', 'reports.operational.read', 'sales.sale.read',
      ],
      hr_manager: [
        'hr.employee.manage', 'hr.employee.read', 'hr.employee.read_sensitive', 'hr.payroll.read',
        'organization.member.read',
      ],
      payroll_officer: [
        'hr.employee.read', 'hr.employee.read_sensitive', 'hr.payroll.prepare', 'hr.payroll.read',
      ],
      auditor: [
        'finance.report.read', 'inventory.cost.read', 'inventory.product.read', 'inventory.stock.read',
        'organization.branch.read', 'organization.member.read', 'organization.role.read',
        'organization.settings.read', 'purchasing.order.read', 'purchasing.report.read', 'purchasing.supplier.read',
        'reports.operational.read', 'sales.sale.read', 'security.audit.read',
      ],
      logistics_officer: [
        'inventory.product.read', 'inventory.stock.read', 'inventory.stock.transfer', 'logistics.shipment.manage',
        'logistics.shipment.read',
      ],
      viewer: [
        'inventory.product.read', 'inventory.stock.read', 'organization.branch.read', 'reports.operational.read',
        'sales.sale.read',
      ],
    },
  },
  {
    version: 3,
    introducedIn: 'phase 5, sales and point of sale (8d4106d)',
    templates: {
      org_admin: [
        'finance.expense.approve', 'finance.expense.create', 'finance.ledger.reconcile', 'finance.report.read',
        'hr.employee.manage', 'hr.employee.read', 'hr.payroll.read', 'inventory.category.manage',
        'inventory.cost.read', 'inventory.product.archive', 'inventory.product.create', 'inventory.product.read',
        'inventory.product.update', 'inventory.stock.adjust', 'inventory.stock.approve_adjustment',
        'inventory.stock.count', 'inventory.stock.read', 'inventory.stock.transfer', 'logistics.shipment.manage',
        'logistics.shipment.read', 'organization.branch.manage', 'organization.branch.read',
        'organization.member.manage', 'organization.member.read', 'organization.role.manage',
        'organization.role.read', 'organization.settings.manage', 'organization.settings.read',
        'organization.subscription.read', 'purchasing.order.approve', 'purchasing.order.create',
        'purchasing.order.read', 'purchasing.order.receive', 'purchasing.order.submit', 'purchasing.report.read',
        'purchasing.return.create', 'purchasing.supplier.manage', 'purchasing.supplier.read', 'reports.data.export',
        'reports.operational.read', 'sales.customer.manage', 'sales.customer.read', 'sales.payment.confirm',
        'sales.report.read', 'sales.return.accept', 'sales.return.restock', 'sales.sale.create', 'sales.sale.read',
        'sales.sale.refund', 'sales.sale.void', 'sales.session.manage', 'sales.session.supervise',
        'security.audit.read',
      ],
      branch_manager: [
        'finance.expense.create', 'hr.employee.read', 'inventory.product.read', 'inventory.stock.adjust',
        'inventory.stock.approve_adjustment', 'inventory.stock.count', 'inventory.stock.read',
        'inventory.stock.transfer', 'logistics.shipment.read', 'organization.branch.read',
        'organization.member.read', 'purchasing.order.approve', 'purchasing.order.create', 'purchasing.order.read',
        'purchasing.order.receive', 'purchasing.order.submit', 'purchasing.return.create',
        'purchasing.supplier.read', 'reports.operational.read', 'sales.customer.read', 'sales.payment.confirm',
        'sales.return.accept', 'sales.return.restock', 'sales.sale.create', 'sales.sale.read', 'sales.sale.refund',
        'sales.sale.void', 'sales.session.manage', 'sales.session.supervise',
      ],
      inventory_manager: [
        'inventory.category.manage', 'inventory.cost.read', 'inventory.product.archive', 'inventory.product.create',
        'inventory.product.read', 'inventory.product.update', 'inventory.stock.adjust',
        'inventory.stock.approve_adjustment', 'inventory.stock.count', 'inventory.stock.read',
        'inventory.stock.transfer', 'organization.branch.read', 'purchasing.order.create', 'purchasing.order.read',
        'purchasing.order.receive', 'purchasing.order.submit', 'purchasing.report.read', 'purchasing.return.create',
        'purchasing.supplier.manage', 'purchasing.supplier.read', 'reports.operational.read',
      ],
      storekeeper: [
        'inventory.product.read', 'inventory.stock.adjust', 'inventory.stock.count', 'inventory.stock.read',
        'purchasing.order.read', 'purchasing.order.receive',
      ],
      cashier: [
        'inventory.product.read', 'inventory.stock.read', 'sales.customer.read', 'sales.payment.confirm',
        'sales.return.accept', 'sales.sale.create', 'sales.sale.read', 'sales.session.manage',
      ],
      sales_rep: [
        'inventory.product.read', 'inventory.stock.read', 'sales.customer.manage', 'sales.customer.read',
        'sales.sale.create', 'sales.sale.read', 'sales.session.manage',
      ],
      accountant: [
        'finance.expense.approve', 'finance.expense.create', 'finance.ledger.reconcile', 'finance.report.read',
        'inventory.cost.read', 'inventory.product.read', 'organization.branch.read', 'purchasing.order.read',
        'purchasing.report.read', 'purchasing.supplier.read', 'reports.operational.read', 'sales.report.read',
        'sales.sale.read',
      ],
      hr_manager: [
        'hr.employee.manage', 'hr.employee.read', 'hr.employee.read_sensitive', 'hr.payroll.read',
        'organization.member.read',
      ],
      payroll_officer: [
        'hr.employee.read', 'hr.employee.read_sensitive', 'hr.payroll.prepare', 'hr.payroll.read',
      ],
      auditor: [
        'finance.report.read', 'inventory.cost.read', 'inventory.product.read', 'inventory.stock.read',
        'organization.branch.read', 'organization.member.read', 'organization.role.read',
        'organization.settings.read', 'purchasing.order.read', 'purchasing.report.read', 'purchasing.supplier.read',
        'reports.operational.read', 'sales.report.read', 'sales.sale.read', 'security.audit.read',
      ],
      logistics_officer: [
        'inventory.product.read', 'inventory.stock.read', 'inventory.stock.transfer', 'logistics.shipment.manage',
        'logistics.shipment.read',
      ],
      viewer: [
        'inventory.product.read', 'inventory.stock.read', 'organization.branch.read', 'reports.operational.read',
        'sales.sale.read',
      ],
    },
  },
];

/** The template version that ROLE_TEMPLATES currently defines. */
export const ROLE_TEMPLATE_VERSION = ROLE_TEMPLATE_HISTORY[ROLE_TEMPLATE_HISTORY.length - 1].version;

/** Roles created before template versions were recorded (template_version NULL) are treated as version 1. */
export const LEGACY_TEMPLATE_VERSION = 1;

export function templateSnapshot(version: number): RoleTemplateSnapshot | undefined {
  return ROLE_TEMPLATE_HISTORY.find((s) => s.version === version);
}
