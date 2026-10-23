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
  { key: 'platform.support.read', privileged: false, description: 'View support tickets' },
  { key: 'platform.support.manage', privileged: false, description: 'Respond to and resolve support tickets' },
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
    description: 'Handles support tickets; can request (not approve) support access.',
    permissions: ['platform.dashboard.read', 'platform.organization.read', 'platform.support.read', 'platform.support.manage', 'platform.support_access.request'],
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
