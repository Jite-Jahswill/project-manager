# 10. Organizations, branches, members and access (Phase 3)

Contracts for the organization lifecycle API. Authorization model: [04-rbac.md](04-rbac.md) and [rbac-matrix.md](rbac-matrix.md). Tests: `test/organization-lifecycle.e2e-spec.ts`, `test/rbac.e2e-spec.ts`, `test/tenant-isolation.e2e-spec.ts`, `test/review-regressions.e2e-spec.ts`, `test/authorization-matrix.e2e-spec.ts`.

## 10.1 Rules that apply everywhere

- **The caller comes only from the verified session.** Bodies cannot carry owner, user, role or organization fields beyond those documented: unknown fields are rejected with 400.
- **Tenant context comes from membership, not from the URL.** Every `/v1/orgs/:orgId` route needs an active membership of `:orgId` (otherwise 403, the same answer as for a non-existent organization) plus the listed permission. IDs from another organization (branches, members, roles, invitations, overrides) are invisible under RLS, so they return **404** (proven for every route by the authorization sweep).
- **One lock per organization.** Every change to roles, assignments, overrides, members, invitations, branches or the profile locks the organization row and re-derives the caller's permissions inside the lock. A concurrent demotion therefore wins; plan limits and invariants (last owner, last active branch) cannot be raced.
- **Delegation.** You cannot grant, remove, assign or invite with permissions you do not hold yourself (org-wide, or at that branch). Only owners grant, remove or affect the Owner role. Nobody creates or removes their own overrides.
- **Optimistic concurrency** on the organization profile and on branches. Send the `version` you read; a stale one gets 409 `version_conflict` with the current version in the message.
- **Audit.** Every change writes an audit event in the same transaction (`GET /v1/orgs/:orgId/audit-events`, permission `security.audit.read`). Invitation tokens and token hashes are never recorded (tested).
- **Organization and platform authority are separate.** No organization role, Owner included, reaches any `/v1/platform/*` route, support included (tested over every platform route). Platform permission keys cannot be placed in organization roles or overrides (`unknown_permission`).

## 10.2 Onboarding

| Route | Permission | Behavior |
|---|---|---|
| `POST /v1/organizations` `{ name 2–120, slug, defaultCurrency? }` | any authenticated user; rate limit `organization.create.user` (5 per day, fails closed) | **201** with the organization, `membershipId` and `created: true`. The caller becomes the only Owner (org-wide), with the starter role templates, a `MAIN` branch and a trial subscription, in one transaction. **Duplicate-safe:** a retry of the same request (same user, slug and name) returns **200** with the same organization and `created: false`; concurrent identical requests produce one organization. Any other request for a taken slug gets **409 `slug_taken`** |
| `GET /v1/me/organizations` | authenticated | Active memberships in active organizations only |
| `GET /v1/orgs/:orgId` | membership | Profile plus your `membershipId`, `isOwner`, effective `permissions`, `version` |
| `PATCH /v1/orgs/:orgId` `{ version, name?, defaultCurrency? }` | `organization.settings.manage` | Increments `version`. The **slug is immutable** (stable public identifier). `defaultCurrency` applies to new records only |
| `POST /v1/orgs/:orgId/leave` | membership | You leave (status `REVOKED`; roles and overrides removed). The last active owner gets **409 `last_owner`**: add another owner first |

Organization **status** (`ACTIVE` / `SUSPENDED`) is a platform decision (`PATCH /v1/platform/organizations/:organizationId/status`, `platform.organization.suspend`). Members of a suspended organization have no tenant access. There is no self-service deletion: organizations and their history are never deleted by the application (the runtime database role has no DELETE privilege on `organizations`).

## 10.3 Branches

| Route | Permission | Behavior |
|---|---|---|
| `GET /v1/orgs/:orgId/branches?status=ACTIVE\|ARCHIVED` | `organization.branch.read` | All branches (or filtered) |
| `GET /v1/orgs/:orgId/branches/:branchId` | `organization.branch.read` | One branch (`version`, `archivedAt`) |
| `POST /v1/orgs/:orgId/branches` `{ name, code }` | `organization.branch.manage` | Plan limit on active branches; `code` unique per organization (409 `branch_code_taken`) |
| `PATCH /v1/orgs/:orgId/branches/:branchId` `{ version, name?, code? }` | `organization.branch.manage` | Archived branches cannot be edited (409 `branch_archived`) |
| `POST /v1/orgs/:orgId/branches/:branchId/archive` `{ version }` | `organization.branch.manage` | See below. 409 `last_active_branch` for the last active branch (also under concurrent requests) |
| `POST /v1/orgs/:orgId/branches/:branchId/reactivate` `{ version }` | `organization.branch.manage` | Plan limit applies |

**Archiving never deletes anything.** Stock balances, stock movements, role assignments and audit history remain, and stay readable by the organization. While archived:
- the branch accepts no new transactions (stock adjustments → 409 `branch_archived`);
- branch-limited roles there grant nothing;
- no new assignments or invitations can target it;
- open invitations scoped to it are revoked (count returned as `revokedInvitations`).

Reactivation restores the existing assignments. Branches cannot be deleted or moved to another organization: the runtime role has no DELETE privilege on `branches`, and every child table uses composite `(id, organization_id)` foreign keys, including invitations since this phase.

## 10.4 Members

| Route | Permission | Behavior |
|---|---|---|
| `GET /v1/orgs/:orgId/members` | `organization.member.read` | Members with roles (and their branch) |
| `GET /v1/orgs/:orgId/members/:membershipId` | `organization.member.read` | One member, with roles and overrides |
| `PATCH /v1/orgs/:orgId/members/:membershipId` `{ status: ACTIVE\|SUSPENDED\|REVOKED }` | `organization.member.manage` | Suspension takes effect on the next request. `REVOKED` (removal) clears roles and overrides; re-joining needs a new invitation and starts with no access. You cannot change your own status. Owners are changed only by owners; the last active owner is protected (409 `last_owner`) |
| `PUT /v1/orgs/:orgId/members/:membershipId/roles` `{ assignments: [{ roleId, branchId? }] }` | `organization.member.manage` | Replaces the set atomically. Delegation applies; branch-limited assignments report `notAppliedAtBranch` |
| `POST /v1/orgs/:orgId/members/:membershipId/overrides` `{ permissionKey, effect: GRANT\|DENY, branchId?, reason, expiresAt? }` | `organization.role.manage` | Not for yourself, not for owners; delegation applies |
| `DELETE /v1/orgs/:orgId/members/:membershipId/overrides/:overrideId` | `organization.role.manage` | Not your own |

**Ownership transfer:** an owner grants the Owner role to another member (`PUT …/roles`), then removes their own Owner role or leaves. The organization always keeps at least one active owner.

## 10.5 Invitations

| Route | Permission | Behavior |
|---|---|---|
| `POST /v1/orgs/:orgId/invitations` `{ email, roleId?, branchId? }` | `organization.member.manage`; rate limits `invite.org`, `invite.user` | 201. Delegation applies to the role (the Owner role only by owners; never branch-limited). `branchId` requires `roleId` and an active branch. Counts against the member limit while pending. 409 `already_member` for active **or suspended** members. 409 `invitation_pending` if an open invitation exists (also enforced by a unique index under concurrency); an expired one is closed and replaced. The response is the same whether or not the address has a Ventidoc account |
| `GET /v1/orgs/:orgId/invitations?status=pending\|expired` | `organization.member.manage` | Open invitations (never the token or its hash) |
| `POST /v1/orgs/:orgId/invitations/:invitationId/resend` | `organization.member.manage`; same rate limits | Pending or expired invitations. A **new token**, so the previous link stops working, and a fresh 7-day expiry. At most 5 resends (409 `resend_limit`), at least 60 s apart (409 `resend_too_soon`). The resending administrator becomes the inviter and must be able to grant the role now |
| `DELETE /v1/orgs/:orgId/invitations/:invitationId` | `organization.member.manage` | Revokes; the link stops working |
| `POST /v1/invitations/accept` `{ token }` | authenticated, rate limit `accept_invite.user` | Valid only for the invited, **verified** email address, before expiry, if not revoked. Re-checks at acceptance: the member limit, and the inviter's authority to grant the role. Concurrent accepts create one membership. Errors are generic (`invalid_token`) |

Emails go through the transactional outbox (the token is encrypted at rest and wiped after delivery), so an invitation and its email commit or roll back together.

## 10.6 Roles and permissions

| Route | Permission | Behavior |
|---|---|---|
| `GET /v1/permissions` | authenticated | The organization permission catalog and role templates (no platform permissions) |
| `GET /v1/orgs/:orgId/roles` | `organization.role.read` | System and custom roles, permissions, assignment counts |
| `POST /v1/orgs/:orgId/roles`, `PATCH …/:roleId`, `POST …/:roleId/clone`, `DELETE …/:roleId` | `organization.role.manage` | Custom roles. Delegation applies to every permission added or removed. System roles cannot be changed, cloned or deleted. Roles in use (by members or pending invitations) cannot be deleted |
