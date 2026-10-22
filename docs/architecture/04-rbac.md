# 4. Authorization (two independent RBAC systems)

The full role × permission matrix is generated from code: **[rbac-matrix.md](rbac-matrix.md)** (`pnpm api docs:rbac`).

## 4.1 Organization RBAC

**Permission identifiers** are `module.resource.action` (e.g. `inventory.stock.adjust`). Each permission declares:
- **scope**: `ORGANIZATION` (only org-wide grants count) or `BRANCH` (an org-wide grant covers all branches; a grant attached to a branch assignment covers only that branch);
- **sensitivity**: `STANDARD` or `RESTRICTED` (payroll, finance, sensitive HR, audit log, exports);
- **branchAssignable** (org-scoped only): a small set of non-sensitive catalog reads (branches, products, suppliers, customers, employee directory) that also take effect when the role is assigned at a single branch. **No other organization-scoped permission is ever conferred by a branch-limited assignment.** The API reports the ignored ones as `notAppliedAtBranch` on role listings and assignment responses, so the UI never shows access the backend won't grant.

The registry (`src/authz/permission-registry.ts`) is synced into `permissions`, and `role_permissions` has an FK to it, so roles can only hold real permissions. Permissions for modules not yet built (HR, payroll, finance, sales…) are already declared, so templates and the matrix are stable.

### Evaluation (`src/authz/permission-evaluator.ts`, pure and unit-tested)

1. Unknown key → **deny**.
2. Owner → **allow**. Owners can't receive overrides.
3. Any matching **DENY** override → **deny**.
4. Any matching role grant or **GRANT** override → **allow**.
5. Otherwise → **deny**.

Inputs are reloaded from the database on every request (memberships, role assignments, overrides with expiry). Suspending a member, removing a role or adding a DENY therefore applies to the very next request, even with an unexpired access token (tested).

### Administration rules (`src/organizations/access-control.service.ts`)

| Rule | Why |
|---|---|
| **Delegation**: a non-owner can only grant, assign, revoke or edit permissions they hold themselves, at the same scope | Stops `organization.role.manage` holders from escalating to payroll approval, or editing their own role upward (tested). |
| Only owners grant or remove the Owner role, or change an owner's membership | Admins can't take over or lock out owners. |
| Can't remove the **last active owner** (`409 last_owner`) | Prevents unrecoverable organizations; a second owner must be added first. A support-assisted recovery workflow is pending. |
| Can't change your own membership status or create overrides for yourself | Self-service escalation and accidental lockout. |
| System roles can't be edited, cloned or deleted; roles in use can't be deleted | Integrity. |
| Every RBAC mutation locks the organization row and **re-loads the actor's access inside the lock** | Serializes concurrent changes; a concurrent demotion of the actor wins (no stale-snapshot escalation); last-owner and limit checks are race-free. |
| Revoking a membership removes all its role assignments and overrides; revoked memberships can't receive roles or overrides | Re-inviting someone never resurrects old privileges. |
| Invitations are re-validated on acceptance against the inviter's **current** access; pending invitations can be listed and revoked | A demoted or removed inviter's invitations stop working. |
| Every mutation writes an audit event (before/after) in the same transaction | Requirement §8. |

### Field-level protection and separation of duties

- Sensitive data gets **separate permissions and separate endpoints/DTOs**. For example, `hr.employee.read` (directory) vs `hr.employee.read_sensitive` (salary, bank details, private documents). The HR module must ship two response DTOs; the directory DTO must not contain sensitive fields at all.
- Separation of duties is modelled with separate permissions (`hr.payroll.prepare` vs `hr.payroll.approve`; no template holds both, enforced by a unit test). Workflow services must also reject approval when `approver = preparer`. That check ships with the payroll and stock-approval workflows.

## 4.2 Platform RBAC

- Separate registry (`platform-permission-registry.ts`), tables (`platform_*`), loader and guard (`@RequirePlatformPermission`).
- **No platform permission grants business-data access.** Platform endpoints run in `asPlatform` scope, where RLS exposes only organization metadata, subscriptions and audit events. A super administrator gets `403` on every `/v1/orgs/:orgId/*` route (tested).
- **MFA:** every platform route requires an MFA-verified session, and MFA is mandatory for every active platform administrator ([mfa.md](../security/mfa.md)). Organization owners must also use MFA: `OrgAccessGuard` refuses owner access from a session without a verified second factor.
- Administrative MFA recovery is **two-person**: `platform.user_mfa.recovery.request` and `platform.user_mfa.recovery.approve` (both privileged), with separation of duties enforced in the database (mfa.md §8).
- **Privileged** platform permissions (marked in the registry) require a password re-entry on the current session within 10 minutes (`POST /v1/auth/reauthenticate`, `step_up_required` otherwise). MFA will join this requirement.
- **Bootstrap**: `pnpm api bootstrap:super-admin --email <verified user> --confirm`. It works only while no active super administrator exists. It needs shell plus DB credentials, has no HTTP endpoint and no default password, and is audited.

### Support access (designed, not built)

`support_access_grants(id, organization_id, platform_user_id, reason, scope_permissions[], requested_at, approved_by, approved_at, starts_at, expires_at ≤ 24h, revoked_at)`:
1. A support agent requests access with a justification (`platform.support_access.request`).
2. A different person approves: an organization owner, or a holder of `platform.support_access.approve` for emergencies. Self-approval is rejected.
3. While active, `OrgAuthzService` produces an `EffectiveAccess` limited to `scope_permissions` (read-only by default), flagged `viaSupportGrant`. Every request is audited into the **organization's** audit log, so the customer can see it.
4. Grants expire automatically; owners can revoke at any time.
