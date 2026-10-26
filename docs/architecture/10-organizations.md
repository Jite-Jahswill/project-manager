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
| `POST /v1/orgs/:orgId/roles`, `PATCH …/:roleId` `{version, name?, description?, permissions?}`, `POST …/:roleId/clone`, `DELETE …/:roleId?version=` | `organization.role.manage` | Custom and template roles (the Owner role cannot be changed, cloned or deleted). Delegation applies to every permission added or removed. Unknown and platform permission keys are refused (`unknown_permission`). **Optimistic concurrency** (§10.6.2): edits and deletions name the role `version` they were based on; a stale version gets `409 version_conflict` and changes nothing. Roles in use (by members or pending invitations) cannot be deleted |

### 10.6.1 Template versions and existing organizations

Every new organization gets an Owner role (system, locked; holds every permission without stored rows) and one role per template in `src/authz/role-templates.ts`. Those template roles are ordinary roles of the organization: administrators may rename them, change their permissions or delete them. A role's **identity** as a template role is `template_key` (set at creation; the API never changes it, and clones and custom roles never have one), not its name.

Templates are **versioned**. `src/authz/role-template-history.ts` keeps a frozen, full snapshot per version; `ROLE_TEMPLATE_VERSION` is the newest. `roles.template_version` records which version's permissions a template role has received:

| Version | Shipped with | Added to templates |
|---|---|---|
| 1 | stage 1 to phase 3 | (baseline) |
| 2 | phase 4: inventory and purchasing | stock counts, categories, cost prices, purchase-order read/submit, supplier returns, purchasing reports |
| 3 | phase 5: sales and point of sale | cashier sessions, voids, returns and restocking, sales reports |
| 4 | phase 6: finance | expense reading, voiding and categories, cash movements and reversals, finance exports ([13-finance.md §13.6](13-finance.md#136-permissions)) |

New organizations are created at the current version. Template roles created before versions were recorded have `template_version` NULL and are treated as **version 1**.

**Sync.** `pnpm api db:seed` (required after every migration) runs `syncRoleTemplates()`; `pnpm api roles:sync-templates [--dry-run]` runs only the sync, or previews it. For each organization, in its own transaction, it locks the organization's template roles and, for each one below the current version:

- **Grants what later versions added** to that role's template, compared with the role's version. Only keys in the organization permission catalog are granted (platform permissions are a separate table and a foreign key keeps them out of `role_permissions`).
- **Never grants a key the organization deliberately removed** from that role. Removing a permission from a template role through `PATCH …/roles/:roleId` records it in `role_permission_exclusions` (who, when); adding it back withdraws the exclusion. Excluded keys are *withheld* and reported. (Removals made before Phase 5.2 were backfilled from the audited role edits by migration `20261029090000_role_versions_and_exclusions`.)
- **Never removes anything.** No template version has removed a permission from a template (a unit test enforces this). A future removal would need its own, explicit migration path.
- **Records the version** and writes one `organization.role.template_upgraded` audit event (actor `SYSTEM`) per role that gained or withheld permissions, with before, after, added and withheld.
- **Leaves alone**: custom roles (including clones), the Owner role, membership role assignments, permission overrides (GRANT/DENY keep their precedence: a DENY still beats a newly granted role permission), roles from an unknown template, and roles at a newer version than the running code (both reported). Deleted template roles are not recreated (reported as missing).
- Suspended organizations are synced too; suspension is enforced at access time.

The policy is therefore **selective reconciliation**: an organization's customizations win (its additions stay, its removals stay removed, its names stay), and only permissions it has never been offered are added.

**Safety and concurrency.** The seed connects as the schema owner, which forced RLS binds as well. Narrow policies `TO ventidoc_migrator`, active only while the transaction sets `app.template_sync = 'on'` (`app_template_sync_scope()`), let it read organizations, template roles, their permissions and exclusions; update template roles; insert permissions into template roles only; and write its own audit events. There is no delete or update policy on `role_permissions`, so the sync cannot remove a permission even by mistake. The runtime role gains nothing from the setting. The sync locks the organization's template roles, like role edits do, so the two serialize; a sync that grants permissions increments the role's `version`, so an edit based on the role as it was before the sync is refused (`409`) rather than silently removing the new permissions. A second, concurrent sync waits and then finds the roles at the current version. Running the sync again changes nothing.

**Enforcement.** The seed records the synced version in `role_template_state`. The API refuses to start while that is behind `ROLE_TEMPLATE_VERSION` (like the permission catalog check), so a deployment cannot serve new code against organizations whose roles were not synced.

**Changing a template:** edit `ROLE_TEMPLATES`, append a snapshot equal to it to `ROLE_TEMPLATE_HISTORY` (a unit test fails until you do), deploy, run `pnpm api db:seed`.

### 10.6.2 Role versions (optimistic concurrency)

Every role has a `version` (starts at 1; returned by `GET …/roles` and by create, clone and update). It is incremented by every successful edit (name, description or permissions) and by template sync grants.

- `PATCH …/roles/:roleId` requires `version` in the body (integer ≥ 1); `DELETE …/roles/:roleId` requires `?version=`. Missing, non-integer or < 1 → `400`.
- The service locks the role row, then compares. Equal: the role, its permissions and its exclusions are changed in one transaction, and the response carries the new version. Different (older or newer): `409 {"code": "version_conflict", "message": "The role changed (current version N); reload and retry"}` and nothing is changed. The body contains only the current version number, never the role's name or permissions.
- Of any number of concurrent edits (or an edit and a delete) based on the same version, exactly one succeeds; the others get `409` (or `404` once the role is deleted).
- Authorization comes first: a caller without `organization.role.manage` gets `403`, and a role of another organization is `404` (under row-level security it does not exist), so a conflict response never reveals another tenant's role.
- Any refusal (delegation, name taken, role in use) rolls back the whole request, including the version.
- Clients: reload the role (`GET …/roles`), re-apply the change, and resubmit with the new version. There is no field-level merge: `permissions` is still the complete set, which is safe because it can only be applied to the version it was computed from.

Breaking change for API clients: `PATCH` without `version` and `DELETE` without `?version=` now get `400`.

