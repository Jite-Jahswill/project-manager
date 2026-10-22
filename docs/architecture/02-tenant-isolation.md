# 2. Tenant-isolation strategy

Isolation is enforced in **four independent layers**. A bug in any one of them should not expose another tenant's data.

## Layer 1: authorization from server-side state

- The organization ID in the URL (`/v1/orgs/:orgId/...`) is treated as an **unverified claim**.
- `OrgAccessGuard` loads the caller's **active** membership in that organization (and requires the organization to be `ACTIVE`). It then evaluates the required permission from the database, never from token claims or request bodies.
- "No such organization" and "not a member" return the same `403`, so IDs can't be probed.
- `ValidationPipe({ whitelist, forbidNonWhitelisted })` rejects unknown body fields such as `organizationId`, `isSystem` or `templateKey` with `400`, so they can't be smuggled in.

## Layer 2: a single, typed path to tenant data

`TenantDb` (`apps/api/src/database/tenant-db.service.ts`) is the only way services reach tenant tables:

| Method | Sets | Used for |
|---|---|---|
| `inOrg(access, fn)` | `app.org_id`, `app.user_id` | All organization work. Requires an `EffectiveAccess`, which only `OrgAuthzService` produces. |
| `inOrgUnchecked(orgId, userId, fn)` | same | Only: loading the membership itself, creating an org (server-generated ID), accepting an invitation (gated by a secret token). |
| `asUser(userId, fn)` | `app.user_id` | Listing the caller's own memberships (org switcher). |
| `asPlatform(userId, fn)` | `app.platform_scope=on` | Platform admin endpoints behind `PlatformAccessGuard`. |

Settings are applied with `set_config(name, value, is_local => true)` **inside a transaction**, so they are discarded at COMMIT/ROLLBACK. This makes them safe with connection pooling, including PgBouncer in **transaction** mode. Session-level `SET` is never used.

## Layer 3: PostgreSQL Row-Level Security

Migration `20261021211700_security_foundation`:

- The runtime connects as **`ventidoc_app`**: `NOSUPERUSER NOBYPASSRLS`, owns no tables, has no `CREATE` on the schema. `loadConfig()` refuses to start with any other DB user. Migrations run as **`ventidoc_migrator`**, the schema owner and not a superuser.
- RLS is **ENABLED and FORCED** on every table with an `organization_id` column, plus `organizations`. Tests fail the build if a new tenant table lacks it, or if any tenant-table policy isn't bound to `ventidoc_app`, isn't keyed on the tenant context, or exposes a business table in platform scope (policy lint).
- Policies compare `organization_id = app_current_org_id()`. With no context the function returns `NULL`, which matches nothing, so queries **fail closed** and return zero rows.
- **Membership-bound** (since `20261022120100`): every tenant policy also requires the context **user** to be an active member of the context organization, verified in the database by SECURITY DEFINER helpers owned by the NOLOGIN `ventidoc_rls` role.
  - Business tables accept active members only.
  - RBAC/admin tables additionally accept a verified invitee during acceptance (live invitation + token hash + the user's verified email).
  - Membership rows can be inserted only for the context user, via such an invitation or as the creator of a brand-new organization.
  - A wrong-tenant context opened for a non-member therefore sees and changes nothing.
  - Details and residual risk: [security gate](../security/2026-10-22-security-gate.md).
- Special policies:
  - `organizations` is readable where `id` = current org, in platform scope, or (only when **no** org context is set) where the user has an active membership. Writes require that org's context. There is no DELETE policy.
  - `organization_memberships` is readable in the org's context, or for the user's own rows when no org context is set (org switcher). Inside org A, memberships elsewhere are invisible.
  - `organization_subscriptions` is readable by the org. The org may insert only its initial `TRIALING` subscription of at most 31 days; everything else, including **all updates**, needs platform scope, so organizations can't upgrade themselves.
  - `audit_events` is readable in the org's context. Platform scope sees only identity/platform events (`organization_id IS NULL`) and actions taken by platform administrators, **not tenants' business audit trail**.
  - Global catalogs (`plans`, `plan_prices`, `plan_entitlements`, `platform_*` RBAC tables) are readable by the app role but writable only in platform scope.
- **Platform scope is referenced by no business-data policy** (products, stock, branches, roles, memberships…). A platform administrator therefore sees zero business rows even with a direct SQL connection as the app role.
- Policies are declared `TO ventidoc_app`. Any other role (including the owner, because RLS is forced) matches no policy and is denied by default.

## Layer 4: relational integrity

- **Composite foreign keys** `(child.x_id, child.organization_id) → parent(id, organization_id)` on role permissions, role assignments, overrides, invitations, stock balances and stock movements. The database rejects linking organization A's membership to organization B's role or branch even if every application check were bypassed (tested).
- CHECK constraints: non-negative stock, non-zero movements, normalized emails, ISO currency codes, non-negative prices and limits.
- `NULLS NOT DISTINCT` unique indexes prevent duplicate role assignments and overrides.
- `audit_events` and `stock_movements` are **append-only**. The app role has no UPDATE/DELETE privilege, and a `BEFORE UPDATE OR DELETE` trigger raises for any role that bypasses RLS.

## Shared resources

Global catalogs (`permissions`, `platform_permissions`, `plans`, `plan_prices`, `plan_entitlements`) have no tenant column and are read-only or platform-managed. Future cross-organization sharing (e.g. a supplier catalog) must use an explicit share table with its own policy, never an RLS exemption.

## Coverage today, and what's still pending

| Surface | Status |
|---|---|
| REST endpoints | Enforced and tested (`tenant-isolation`, `rbac`, `platform` suites). |
| Search, audit log | Tested. |
| Files / signed URLs, exports, background jobs, WebSockets | **Not built yet.** Design: jobs carry `{organizationId, actorUserId}` and re-run `OrgAuthzService.load` before executing inside `inOrg`; signed URLs are short-lived, object keys are prefixed with `org/<id>/` and issued only after a permission check; WebSocket connections authenticate with the same session check and join rooms only after `OrgAccessGuard`-equivalent validation per subscription. Mandatory tests 2 and 7 (files, exports, jobs, sockets) will be added with those features. |

## Tamper and migration safety

Prisma can't model RLS, triggers, CHECKs or `NULLS NOT DISTINCT` indexes, and `migrate dev` silently generates `DROP INDEX` for the latter. That actually happened during this stage (migration `20261021212241`) and was corrected by `20261021212300`. `pnpm api db:check-migrations` now fails if a protected index is dropped without being recreated, or if the database drifts from the schema in any unexpected way. **Run it in CI and review every generated migration.**

## Known limit of RLS

RLS protects against *missing filters and foreign IDs*, and (since membership-bound policies) against a wrong tenant context for a user who isn't a member there. It can't protect against application code setting **both** a wrong organization **and** the user ID of a genuine member of it. That is why `TenantDb.inOrg` accepts only an `EffectiveAccess` from `OrgAuthzService`, and why the route-generated authorization sweeps (`test/authorization-matrix.e2e-spec.ts`) run in CI. See [the 2026-10-22 security review](../security/2026-10-22-review.md).
