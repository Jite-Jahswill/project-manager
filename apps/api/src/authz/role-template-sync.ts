import { Prisma, PrismaClient } from '../generated/prisma/client';
import { PERMISSIONS } from './permission-registry';
import { LEGACY_TEMPLATE_VERSION, ROLE_TEMPLATE_VERSION, templateSnapshot } from './role-template-history';
import { OWNER_TEMPLATE_KEY, ROLE_TEMPLATES } from './role-templates';

/**
 * Brings the template-derived roles of EXISTING organizations up to the current role
 * template version (docs/architecture/10-organizations.md §10.6). New organizations are
 * created at the current version already.
 *
 * Rules, per template role (templateKey set, not a system role):
 * - Grant only what later template versions ADDED to the role's template, compared with
 *   the version the role has (NULL = version 1). Nothing is ever removed.
 * - Never grant a permission the organization explicitly removed from that role: the last
 *   audited change of that key on the role (organization.role.updated) was a removal. Such
 *   keys are withheld and reported.
 * - Custom roles, the Owner role, memberships, assignments and overrides are never touched.
 *   Renamed template roles still sync (identity is templateKey, which the API never changes).
 *   Deleted template roles are not recreated.
 *
 * Runs as the schema owner (the seed) under the app.template_sync policies, one transaction
 * per organization with the organization's template roles locked, so it is idempotent and
 * safe to run concurrently with itself and with role edits.
 */

export type RolePlan =
  | { kind: 'upgrade'; fromVersion: number; toVersion: number; add: string[]; withheld: string[] }
  | { kind: 'current' }
  | { kind: 'ahead'; templateVersion: number }
  | { kind: 'unknown_template' };

export interface RolePlanInput {
  templateKey: string;
  templateVersion: number | null;
  current: readonly string[];
  /** Keys whose last audited change on this role was a removal. */
  explicitlyRemoved: ReadonlySet<string>;
}

const ORG_CATALOG: ReadonlySet<string> = new Set(PERMISSIONS.keys());

export function planRoleUpgrade(input: RolePlanInput, toVersion = ROLE_TEMPLATE_VERSION, catalog = ORG_CATALOG): RolePlan {
  const fromVersion = input.templateVersion ?? LEGACY_TEMPLATE_VERSION;
  if (fromVersion > toVersion) return { kind: 'ahead', templateVersion: fromVersion };
  const target = templateSnapshot(toVersion)?.templates[input.templateKey];
  if (!target) return { kind: 'unknown_template' };
  if (fromVersion === toVersion) return { kind: 'current' };
  const from = templateSnapshot(fromVersion);
  if (!from) throw new Error(`Role template version ${fromVersion} is not in ROLE_TEMPLATE_HISTORY`);
  const offered = new Set(from.templates[input.templateKey] ?? []);
  const held = new Set(input.current);
  // Organization catalog only: platform permissions and retired keys can never be granted.
  const introduced = target.filter((k) => !offered.has(k) && !held.has(k) && catalog.has(k));
  return {
    kind: 'upgrade', fromVersion, toVersion,
    add: introduced.filter((k) => !input.explicitlyRemoved.has(k)).sort(),
    withheld: introduced.filter((k) => input.explicitlyRemoved.has(k)).sort(),
  };
}

/** Replays a role's permission edits (oldest first): the keys whose last change was a removal. */
export function explicitlyRemovedKeys(edits: readonly { added?: unknown; removed?: unknown }[]): Set<string> {
  const last = new Map<string, 'added' | 'removed'>();
  const keys = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []);
  for (const e of edits) {
    for (const k of keys(e.added)) last.set(k, 'added');
    for (const k of keys(e.removed)) last.set(k, 'removed');
  }
  return new Set([...last].filter(([, change]) => change === 'removed').map(([k]) => k));
}

export interface RoleChange {
  organizationId: string;
  roleId: string;
  roleName: string;
  templateKey: string;
  fromVersion: number;
  added: string[];
  withheld: string[];
}

export interface RoleTemplateSyncReport {
  toVersion: number;
  dryRun: boolean;
  organizations: number;
  templateRoles: number;
  /** Roles moved to the current version (with or without new permissions). */
  rolesUpgraded: number;
  permissionsGranted: number;
  /** Roles that received permissions or had some withheld. */
  changes: RoleChange[];
  /** Template roles the organization no longer has (deleted by the organization; not recreated). */
  missingRoles: { organizationId: string; templateKeys: string[] }[];
  /** Roles whose templateKey no current template defines (left untouched). */
  unknownTemplates: { organizationId: string; roleId: string; templateKey: string }[];
  /** Roles already at a newer version than this code knows (left untouched). */
  ahead: { organizationId: string; roleId: string; templateVersion: number }[];
}

interface RoleRow { id: string; name: string; template_key: string; template_version: number | null }

const EXPECTED_KEYS = [OWNER_TEMPLATE_KEY, ...ROLE_TEMPLATES.map((t) => t.key)];

export async function syncRoleTemplates(prisma: PrismaClient, opts: { dryRun?: boolean } = {}): Promise<RoleTemplateSyncReport> {
  const dryRun = opts.dryRun ?? false;
  const report: RoleTemplateSyncReport = {
    toVersion: ROLE_TEMPLATE_VERSION, dryRun, organizations: 0, templateRoles: 0, rolesUpgraded: 0, permissionsGranted: 0,
    changes: [], missingRoles: [], unknownTemplates: [], ahead: [],
  };
  const orgIds = await inSyncScope(prisma, async (tx) =>
    (await tx.$queryRaw<{ id: string }[]>`SELECT id FROM organizations ORDER BY id`).map((r) => r.id));
  for (const orgId of orgIds) {
    await inSyncScope(prisma, (tx) => syncOrganization(tx, orgId, report, dryRun));
    report.organizations++;
  }
  if (!dryRun) {
    await prisma.$executeRaw`
      INSERT INTO role_template_state (id, version, synced_at) VALUES (1, ${ROLE_TEMPLATE_VERSION}, now())
      ON CONFLICT (id) DO UPDATE SET version = GREATEST(role_template_state.version, EXCLUDED.version), synced_at = now()`;
  }
  return report;
}

async function syncOrganization(tx: Prisma.TransactionClient, orgId: string, report: RoleTemplateSyncReport, dryRun: boolean): Promise<void> {
  // Locks the organization's template roles (in id order): concurrent syncs serialize here and the
  // later one re-reads the committed versions; role edits lock the same rows (AccessControlService).
  const roles = await tx.$queryRaw<RoleRow[]>`
    SELECT id, name, template_key, template_version FROM roles
    WHERE organization_id = ${orgId}::uuid AND template_key IS NOT NULL AND NOT is_system
    ORDER BY id FOR UPDATE`;
  const present = new Set((await tx.$queryRaw<{ template_key: string }[]>`
    SELECT template_key FROM roles WHERE organization_id = ${orgId}::uuid AND template_key IS NOT NULL`).map((r) => r.template_key));
  const missing = EXPECTED_KEYS.filter((k) => !present.has(k));
  if (missing.length) report.missingRoles.push({ organizationId: orgId, templateKeys: missing });
  report.templateRoles += roles.length;
  const pending = roles.filter((r) => (r.template_version ?? LEGACY_TEMPLATE_VERSION) !== ROLE_TEMPLATE_VERSION);
  if (!pending.length) return;

  const ids = pending.map((r) => r.id);
  const perms = await tx.$queryRaw<{ role_id: string; permission_key: string }[]>`
    SELECT role_id, permission_key FROM role_permissions WHERE organization_id = ${orgId}::uuid AND role_id = ANY(${ids}::uuid[])`;
  const edits = await tx.$queryRaw<{ resource_id: string; metadata: { added?: unknown; removed?: unknown } | null }[]>`
    SELECT resource_id, metadata FROM audit_events
    WHERE organization_id = ${orgId}::uuid AND resource_type = 'role' AND action = 'organization.role.updated'
      AND resource_id = ANY(${ids}::text[])
    ORDER BY occurred_at, id`;

  for (const role of pending) {
    const current = perms.filter((p) => p.role_id === role.id).map((p) => p.permission_key).sort();
    const plan = planRoleUpgrade({
      templateKey: role.template_key, templateVersion: role.template_version, current,
      explicitlyRemoved: explicitlyRemovedKeys(edits.filter((e) => e.resource_id === role.id).map((e) => e.metadata ?? {})),
    });
    if (plan.kind === 'unknown_template') { report.unknownTemplates.push({ organizationId: orgId, roleId: role.id, templateKey: role.template_key }); continue; }
    if (plan.kind === 'ahead') { report.ahead.push({ organizationId: orgId, roleId: role.id, templateVersion: plan.templateVersion }); continue; }
    if (plan.kind === 'current') continue;

    report.rolesUpgraded++;
    report.permissionsGranted += plan.add.length;
    if (plan.add.length || plan.withheld.length) {
      report.changes.push({
        organizationId: orgId, roleId: role.id, roleName: role.name, templateKey: role.template_key,
        fromVersion: plan.fromVersion, added: plan.add, withheld: plan.withheld,
      });
    }
    if (dryRun) continue;
    if (plan.add.length) {
      await tx.$executeRaw`
        INSERT INTO role_permissions (organization_id, role_id, permission_key)
        SELECT ${orgId}::uuid, ${role.id}::uuid, k FROM unnest(${plan.add}::text[]) AS k
        ON CONFLICT DO NOTHING`;
    }
    await tx.$executeRaw`
      UPDATE roles SET template_version = ${plan.toVersion}, updated_at = CASE WHEN ${plan.add.length > 0} THEN now() ELSE updated_at END
      WHERE id = ${role.id}::uuid`;
    if (plan.add.length || plan.withheld.length) {
      const metadata = JSON.stringify({ templateKey: role.template_key, fromVersion: plan.fromVersion, toVersion: plan.toVersion, added: plan.add, withheld: plan.withheld });
      await tx.$executeRaw`
        INSERT INTO audit_events (organization_id, actor_type, action, resource_type, resource_id, before, after, metadata)
        VALUES (${orgId}::uuid, 'SYSTEM'::"ActorType", 'organization.role.template_upgraded', 'role', ${role.id},
          ${JSON.stringify({ permissions: current })}::jsonb, ${JSON.stringify({ permissions: [...current, ...plan.add].sort() })}::jsonb,
          ${metadata}::jsonb)`;
    }
  }
}

function inSyncScope<T>(prisma: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.template_sync', 'on', true)`;
    return fn(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60_000, maxWait: 30_000 });
}

/** One line per fact, for the seed and CLI output. Role and organization IDs only; no personal data. */
export function formatSyncReport(r: RoleTemplateSyncReport): string[] {
  const lines = [
    `Role templates${r.dryRun ? ' (dry run)' : ''}: version ${r.toVersion}; ${r.organizations} organizations, ${r.templateRoles} template roles, `
      + `${r.rolesUpgraded} upgraded, ${r.permissionsGranted} permissions granted.`,
  ];
  for (const c of r.changes) {
    lines.push(`  org ${c.organizationId} role ${c.roleId} (${c.templateKey}, v${c.fromVersion}): +[${c.added.join(', ')}]`
      + (c.withheld.length ? ` withheld (explicitly removed by the organization): [${c.withheld.join(', ')}]` : ''));
  }
  for (const m of r.missingRoles) lines.push(`  org ${m.organizationId}: template roles not present (not recreated): ${m.templateKeys.join(', ')}`);
  for (const u of r.unknownTemplates) lines.push(`  org ${u.organizationId} role ${u.roleId}: unknown template "${u.templateKey}" (left unchanged)`);
  for (const a of r.ahead) lines.push(`  org ${a.organizationId} role ${a.roleId}: at version ${a.templateVersion}, newer than this code (left unchanged)`);
  return lines;
}
