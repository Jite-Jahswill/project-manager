import { PERMISSIONS } from './permission-registry';

/**
 * Pure permission evaluation. No I/O: OrgAuthzService loads the inputs from the
 * database on every request, so a role change or revocation takes effect on the
 * next request regardless of what an access token says.
 *
 * Precedence (documented in docs/architecture/04-rbac.md):
 *   1. Unknown permission keys are denied.
 *   2. Owners are granted everything. Overrides cannot be attached to owners.
 *   3. A matching DENY override wins over any grant.
 *   4. A matching GRANT override or role grant allows.
 *   5. Otherwise denied.
 *
 * "Matching" depends on the permission's scope:
 *   ORGANIZATION - only entries with branchId = null count, except permissions
 *                  marked branchAssignable (catalog reads), for which an entry from
 *                  a branch assignment also counts.
 *   BRANCH       - an entry with branchId = null covers every branch; an entry with a
 *                  branchId covers only that branch. Asking without a branchId means
 *                  "for all branches" and therefore needs an organization-wide entry.
 */
export interface PermissionEntry {
  permission: string;
  /** null = organization-wide. */
  branchId: string | null;
}

export interface EffectiveAccess {
  userId: string;
  organizationId: string;
  membershipId: string;
  isOwner: boolean;
  grants: readonly PermissionEntry[];
  denies: readonly PermissionEntry[];
}

function matches(entry: PermissionEntry, key: string, branchId: string | undefined, branchScoped: boolean, branchAssignable: boolean): boolean {
  if (entry.permission !== key) return false;
  if (entry.branchId === null) return true;
  if (!branchScoped) return branchAssignable;
  return branchId !== undefined && entry.branchId === branchId;
}

export function can(access: EffectiveAccess, key: string, branchId?: string): boolean {
  const def = PERMISSIONS.get(key);
  if (!def) return false;
  if (access.isOwner) return true;
  const branchScoped = def.scope === 'BRANCH';
  const assignable = !!def.branchAssignable;
  if (access.denies.some((d) => matches(d, key, branchId, branchScoped, assignable))) return false;
  return access.grants.some((g) => matches(g, key, branchId, branchScoped, assignable));
}

/**
 * Which branches a BRANCH-scoped permission applies to: 'ALL' when held
 * organization-wide, otherwise the specific branch IDs (minus denied ones).
 */
export function branchesWith(access: EffectiveAccess, key: string): 'ALL' | string[] {
  if (can(access, key)) return 'ALL';
  const def = PERMISSIONS.get(key);
  if (!def || def.scope !== 'BRANCH') return [];
  const ids = new Set(access.grants.filter((g) => g.permission === key && g.branchId).map((g) => g.branchId as string));
  return [...ids].filter((id) => can(access, key, id));
}

/** Organization-wide effective permission keys (for UI hints; never for enforcement). */
export function effectivePermissionKeys(access: EffectiveAccess): { organizationWide: string[]; byBranch: Record<string, string[]> } {
  const organizationWide = [...PERMISSIONS.keys()].filter((k) => can(access, k));
  const byBranch: Record<string, string[]> = {};
  for (const g of access.grants) {
    if (!g.branchId || organizationWide.includes(g.permission)) continue;
    if (!can(access, g.permission, g.branchId)) continue;
    const list = (byBranch[g.branchId] ??= []);
    if (!list.includes(g.permission)) list.push(g.permission);
  }
  return { organizationWide, byBranch };
}

/** Permissions of a role that have no effect when the role is assigned at a single branch. */
export function notAppliedAtBranch(permissionKeys: Iterable<string>): string[] {
  return [...new Set(permissionKeys)]
    .filter((k) => {
      const def = PERMISSIONS.get(k);
      return !!def && def.scope === 'ORGANIZATION' && !def.branchAssignable;
    })
    .sort();
}
