import { Errors } from '../common/errors';
import { can, EffectiveAccess } from './permission-evaluator';
import { PERMISSIONS } from './permission-registry';

/**
 * Anti-escalation rule for every RBAC mutation (role permissions, role
 * assignments, overrides): a non-owner may only grant, assign or remove
 * permissions they themselves hold at the same scope.
 *
 * Without this, anyone with organization.role.manage could add
 * hr.payroll.approve to their own role.
 */
export function missingForDelegation(actor: EffectiveAccess, permissions: Iterable<string>, branchId: string | null): string[] {
  if (actor.isOwner) return [];
  const missing: string[] = [];
  for (const key of new Set(permissions)) {
    const def = PERMISSIONS.get(key);
    if (!def) {
      missing.push(key);
      continue;
    }
    const held = def.scope === 'BRANCH' && branchId ? can(actor, key, branchId) : can(actor, key);
    if (!held) missing.push(key);
  }
  return missing.sort();
}

export function assertCanDelegate(actor: EffectiveAccess, permissions: Iterable<string>, branchId: string | null = null): void {
  const missing = missingForDelegation(actor, permissions, branchId);
  if (missing.length) throw Errors.forbidden(`You cannot grant or revoke permissions you do not hold: ${missing.join(', ')}`);
}
