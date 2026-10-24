/**
 * Central registry of ORGANIZATION permissions.
 *
 * This is the source of truth: prisma/seed.ts syncs it into the `permissions`
 * table, and role_permissions has a foreign key to that table, so a role can never
 * hold a permission that is not declared here. Controllers reference these keys
 * through @RequirePermission(); nothing in the codebase checks role names.
 *
 * Permissions for modules that are not built yet are declared so that role
 * templates and the RBAC matrix are stable from the start.
 *
 * scope:
 *   ORGANIZATION - only an organization-wide grant counts.
 *   BRANCH       - an organization-wide grant covers every branch; a grant attached
 *                  to a branch assignment covers only that branch.
 * sensitivity:
 *   RESTRICTED   - payroll, finance, HR-sensitive, audit and export data. Never
 *                  part of the default read-only templates.
 * branchAssignable (ORGANIZATION scope only):
 *   Non-sensitive reference-data reads that a member needs to work at any branch
 *   (product catalog, branch list, ...). They take effect even when the role is
 *   assigned at a single branch. Every other ORGANIZATION permission is ignored
 *   for branch-limited assignments, so a branch assignment can never confer
 *   organization-wide administration.
 */
export type PermissionScope = 'ORGANIZATION' | 'BRANCH';
export type PermissionSensitivity = 'STANDARD' | 'RESTRICTED';

export interface PermissionDefinition {
  key: string;
  scope: PermissionScope;
  sensitivity: PermissionSensitivity;
  description: string;
  branchAssignable?: boolean;
}

const O = 'ORGANIZATION' as const;
const B = 'BRANCH' as const;
const S = 'STANDARD' as const;
const R = 'RESTRICTED' as const;

const definitions = [
  // Organization administration
  { key: 'organization.settings.read', scope: O, sensitivity: S, description: 'View organization settings' },
  { key: 'organization.settings.manage', scope: O, sensitivity: S, description: 'Change organization settings and theme' },
  { key: 'organization.branch.read', scope: O, sensitivity: S, branchAssignable: true, description: 'List branches' },
  { key: 'organization.branch.manage', scope: O, sensitivity: S, description: 'Create, rename and archive branches' },
  { key: 'organization.member.read', scope: O, sensitivity: S, description: 'List members and their roles' },
  { key: 'organization.member.manage', scope: O, sensitivity: S, description: 'Invite, suspend and assign roles to members' },
  { key: 'organization.role.read', scope: O, sensitivity: S, description: 'View roles and their permissions' },
  { key: 'organization.role.manage', scope: O, sensitivity: R, description: 'Create, edit and delete roles; manage permission overrides' },
  { key: 'organization.subscription.read', scope: O, sensitivity: S, description: 'View subscription plan and usage' },
  { key: 'security.audit.read', scope: O, sensitivity: R, description: 'Read the organization audit log' },

  // Inventory
  { key: 'inventory.product.read', scope: O, sensitivity: S, branchAssignable: true, description: 'View products' },
  { key: 'inventory.product.create', scope: O, sensitivity: S, description: 'Create products' },
  { key: 'inventory.product.update', scope: O, sensitivity: S, description: 'Edit products' },
  { key: 'inventory.product.archive', scope: O, sensitivity: S, description: 'Archive products' },
  { key: 'inventory.stock.read', scope: B, sensitivity: S, description: 'View stock levels and movements' },
  { key: 'inventory.stock.adjust', scope: B, sensitivity: S, description: 'Record stock adjustments' },
  { key: 'inventory.stock.transfer', scope: B, sensitivity: S, description: 'Transfer stock between branches' },
  { key: 'inventory.stock.approve_adjustment', scope: B, sensitivity: S, description: 'Approve stock adjustments and reverse adjustments, opening balances and counts' },
  { key: 'inventory.stock.count', scope: B, sensitivity: S, description: 'Record physical stock counts (posts the differences)' },
  { key: 'inventory.category.manage', scope: O, sensitivity: S, description: 'Create, rename and archive product categories' },
  { key: 'inventory.cost.read', scope: O, sensitivity: R, description: 'View cost prices and purchase costs' },

  // Purchasing
  { key: 'purchasing.supplier.read', scope: O, sensitivity: S, branchAssignable: true, description: 'View suppliers' },
  { key: 'purchasing.supplier.manage', scope: O, sensitivity: S, description: 'Manage suppliers' },
  { key: 'purchasing.order.read', scope: B, sensitivity: S, description: 'View purchase orders (costs need inventory.cost.read unless you create or approve)' },
  { key: 'purchasing.order.create', scope: B, sensitivity: S, description: 'Create and edit draft purchase orders, issue approved ones, cancel drafts' },
  { key: 'purchasing.order.submit', scope: B, sensitivity: S, description: 'Submit purchase orders for approval' },
  { key: 'purchasing.order.approve', scope: B, sensitivity: S, description: 'Approve or reject purchase orders submitted by others; cancel or close approved orders' },
  { key: 'purchasing.order.self_approve', scope: B, sensitivity: R, description: 'Approve a purchase order you submitted yourself (audited)' },
  { key: 'purchasing.order.receive', scope: B, sensitivity: S, description: 'Receive goods against purchase orders' },
  { key: 'purchasing.return.create', scope: B, sensitivity: S, description: 'Return goods to suppliers and correct receipts' },
  { key: 'purchasing.report.read', scope: O, sensitivity: R, description: 'View purchasing reports and supplier purchase history' },

  // Sales
  { key: 'sales.sale.read', scope: B, sensitivity: S, description: 'View sales' },
  { key: 'sales.sale.create', scope: B, sensitivity: S, description: 'Record sales' },
  { key: 'sales.sale.refund', scope: B, sensitivity: S, description: 'Refund sales' },
  { key: 'sales.payment.confirm', scope: B, sensitivity: S, description: 'Confirm payments' },
  { key: 'sales.customer.read', scope: O, sensitivity: S, branchAssignable: true, description: 'View customers' },
  { key: 'sales.customer.manage', scope: O, sensitivity: S, description: 'Manage customers' },

  // Logistics
  { key: 'logistics.shipment.read', scope: B, sensitivity: S, description: 'View shipments and deliveries' },
  { key: 'logistics.shipment.manage', scope: B, sensitivity: S, description: 'Dispatch and update shipments' },

  // Finance
  { key: 'finance.report.read', scope: O, sensitivity: R, description: 'View financial reports' },
  { key: 'finance.expense.create', scope: B, sensitivity: S, description: 'Record expenses' },
  { key: 'finance.expense.approve', scope: O, sensitivity: R, description: 'Approve expenses' },
  { key: 'finance.ledger.reconcile', scope: O, sensitivity: R, description: 'Reconcile accounts' },

  // HR & payroll
  { key: 'hr.employee.read', scope: O, sensitivity: S, branchAssignable: true, description: 'View the employee directory (no salary, bank or private data)' },
  { key: 'hr.employee.read_sensitive', scope: O, sensitivity: R, description: 'View salary, bank details and private employee records' },
  { key: 'hr.employee.manage', scope: O, sensitivity: R, description: 'Create and edit employee records' },
  { key: 'hr.payroll.read', scope: O, sensitivity: R, description: 'View payroll runs' },
  { key: 'hr.payroll.prepare', scope: O, sensitivity: R, description: 'Prepare payroll runs' },
  { key: 'hr.payroll.approve', scope: O, sensitivity: R, description: 'Approve payroll runs (cannot approve own preparation)' },
  { key: 'hr.payroll.export', scope: O, sensitivity: R, description: 'Export payroll data' },

  // Reporting
  { key: 'reports.operational.read', scope: B, sensitivity: S, description: 'View operational reports' },
  { key: 'reports.data.export', scope: O, sensitivity: R, description: 'Export organization data' },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof definitions)[number]['key'];

export const PERMISSIONS: ReadonlyMap<string, PermissionDefinition> = new Map(definitions.map((d) => [d.key, d]));

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = definitions.map((d) => d.key);

export function isPermissionKey(key: string): key is PermissionKey {
  return PERMISSIONS.has(key);
}

/** Splits "inventory.stock.adjust" into its module / resource / action parts. */
export function describeKey(key: string): { module: string; resource: string; action: string } {
  const [module, resource, action] = key.split('.');
  return { module, resource, action };
}
