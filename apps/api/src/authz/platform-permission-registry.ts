/**
 * PLATFORM administration permissions: operating the Ventidoc SaaS itself.
 *
 * Deliberately a separate registry, table (platform_permissions) and guard from
 * organization permissions. No platform permission grants access to an
 * organization's business records (products, stock, sales, HR, finance). The only
 * route to such data will be a time-limited, justified, audited support-access
 * grant (see docs/architecture/04-rbac.md), which is not implemented yet.
 *
 * privileged: requires a recent password re-entry on the current session
 * (step-up). MFA will be added to this requirement when it ships.
 */
export interface PlatformPermissionDefinition {
  key: string;
  privileged: boolean;
  description: string;
}

const definitions = [
  { key: 'platform.dashboard.read', privileged: false, description: 'View platform dashboard and analytics' },
  { key: 'platform.admin.read', privileged: false, description: 'List platform administrators and roles' },
  { key: 'platform.admin.manage', privileged: true, description: 'Grant or revoke platform administrator roles' },
  { key: 'platform.organization.read', privileged: false, description: 'View organization metadata (not business records)' },
  { key: 'platform.organization.suspend', privileged: true, description: 'Suspend or reactivate an organization' },
  { key: 'platform.plan.read', privileged: false, description: 'View subscription plans and entitlements' },
  { key: 'platform.plan.manage', privileged: true, description: 'Create and change plans, prices and entitlements' },
  { key: 'platform.subscription.read', privileged: false, description: 'View subscription records' },
  { key: 'platform.subscription.manage', privileged: true, description: 'Change subscriptions and billing state' },
  { key: 'platform.branding.manage', privileged: false, description: 'Manage platform branding and global themes' },
  { key: 'platform.content.manage', privileged: false, description: 'Manage platform content' },
  { key: 'platform.feature_flag.manage', privileged: true, description: 'Manage feature flags' },
  { key: 'platform.config.manage', privileged: true, description: 'Change system configuration' },
  { key: 'platform.integration.manage', privileged: true, description: 'Manage integrations' },
  { key: 'platform.notification_template.manage', privileged: false, description: 'Manage notification templates' },
  // Customer support (docs/security/support.md). Narrow on purpose: an agent typically holds
  // assigned.access + reply (+ notes, attachments.read, status.manage), never inbox.read or assign.
  { key: 'platform.support.inbox.read', privileged: false, description: 'View the whole support inbox, the unassigned queue and queue metrics' },
  { key: 'platform.support.assigned.access', privileged: false, description: 'Access support conversations assigned to you (and be assignable)' },
  { key: 'platform.support.assign', privileged: false, description: 'Assign, reassign and unassign support conversations' },
  { key: 'platform.support.reply', privileged: false, description: 'Reply to customers in support conversations you can access' },
  { key: 'platform.support.status.manage', privileged: false, description: 'Change status, priority and category of support conversations you can access' },
  { key: 'platform.support.notes', privileged: false, description: 'Read and write internal notes (never visible to customers)' },
  { key: 'platform.support.attachments.read', privileged: false, description: 'Download attachments in support conversations you can access' },
  { key: 'platform.support.audit.read', privileged: false, description: 'View support conversation lifecycle history' },
  { key: 'platform.support_access.request', privileged: false, description: 'Request time-limited access to an organization' },
  { key: 'platform.support_access.approve', privileged: true, description: 'Approve support-access requests' },
  { key: 'platform.security.read', privileged: false, description: 'View security events' },
  { key: 'platform.email.read', privileged: false, description: 'View email configuration (never secrets), templates and audit history' },
  { key: 'platform.email.configure', privileged: true, description: 'Change email providers, sender identities, retry policy and production sending' },
  { key: 'platform.email.secrets.manage', privileged: true, description: 'Set or clear email provider credentials (write-only)' },
  { key: 'platform.email.templates.manage', privileged: true, description: 'Create and activate email template versions' },
  { key: 'platform.email.deliveries.read', privileged: false, description: 'View delivery status, metrics and suppressions (metadata only)' },
  { key: 'platform.email.deliveries.manage', privileged: true, description: 'Retry or cancel deliveries and manage suppressions' },
  { key: 'platform.email.test_send', privileged: true, description: 'Send a test email to an authorized recipient' },
  { key: 'platform.user_mfa.recovery.request', privileged: true, description: "Request a user's two-step verification recovery (needs a second administrator's approval)" },
  { key: 'platform.user_mfa.recovery.approve', privileged: true, description: 'Approve or reject another administrator\'s two-step verification recovery request' },
  { key: 'platform.audit.read', privileged: false, description: 'Read platform-wide audit logs' },
  { key: 'platform.health.read', privileged: false, description: 'View platform health and operational monitoring' },
] as const satisfies readonly PlatformPermissionDefinition[];

export type PlatformPermissionKey = (typeof definitions)[number]['key'];

export const PLATFORM_PERMISSIONS: ReadonlyMap<string, PlatformPermissionDefinition> = new Map(
  definitions.map((d) => [d.key, d]),
);

export const SUPER_ADMIN_ROLE_NAME = 'Super administrator';

export const PLATFORM_ROLE_TEMPLATES: readonly { name: string; description: string; permissions: readonly PlatformPermissionKey[] }[] = [
  {
    name: SUPER_ADMIN_ROLE_NAME,
    description: 'Every platform permission. Still has no access to organization business records.',
    permissions: definitions.map((d) => d.key),
  },
  {
    name: 'Support agent',
    description: 'Works the support conversations assigned to them; cannot browse the inbox or assign. Can request (not approve) support access.',
    permissions: [
      'platform.dashboard.read', 'platform.organization.read', 'platform.support_access.request',
      'platform.support.assigned.access', 'platform.support.reply', 'platform.support.status.manage', 'platform.support.notes',
      'platform.support.attachments.read',
    ],
  },
  {
    name: 'Support administrator',
    description: 'Runs the support inbox: sees every conversation, assigns and reassigns, and can work any conversation.',
    permissions: [
      'platform.dashboard.read', 'platform.organization.read',
      'platform.support.inbox.read', 'platform.support.assigned.access', 'platform.support.assign', 'platform.support.reply',
      'platform.support.status.manage', 'platform.support.notes', 'platform.support.attachments.read', 'platform.support.audit.read',
    ],
  },
  {
    name: 'Billing manager',
    description: 'Manages plans and subscriptions. No access to tenant financial transactions.',
    permissions: ['platform.dashboard.read', 'platform.organization.read', 'platform.plan.read', 'platform.plan.manage', 'platform.subscription.read', 'platform.subscription.manage'],
  },
  {
    name: 'Security auditor',
    description: 'Reads security events and audit logs.',
    permissions: ['platform.security.read', 'platform.audit.read', 'platform.admin.read', 'platform.health.read'],
  },
  {
    name: 'Email operations',
    description: 'Email configuration, templates and deliveries; cannot manage provider credentials.',
    permissions: [
      'platform.email.read', 'platform.email.configure', 'platform.email.templates.manage', 'platform.email.deliveries.read',
      'platform.email.deliveries.manage', 'platform.email.test_send',
    ],
  },
  {
    name: 'Content manager',
    description: 'Branding, content and notification templates.',
    permissions: ['platform.branding.manage', 'platform.content.manage', 'platform.notification_template.manage'],
  },
];
