# Security gate before the initial commit (2026-10-22)

Follows [the security review](2026-10-22-review.md). Covers its two open structural concerns (password-hash exposure and wrong-tenant writes) and classifies all other outstanding work.

**Verdict: the foundation is safe to commit as a development baseline. It is not production-ready.** The API still refuses `NODE_ENV=production`, and the release blockers in §3 remain.

## A. Password-hash exposure: resolved for the application role

**Before.** `users.password_hash` sat on a table the runtime role `ventidoc_app` reads for every request. Any SQL-injection or query bug anywhere in the API could read every user's hash.

**Constraint.** Verification uses argon2id in Node. PostgreSQL has no argon2, so the hash must reach the API process. Verifying inside the database (pgcrypto `crypt()`) was rejected for three reasons:
- it would downgrade to bcrypt;
- it would send plaintext passwords over the database connection, where statement logging could capture them;
- it would move CPU-heavy hashing onto the database.

**Change** (migration `20261022120000_credential_isolation`):
- Hashes moved to `user_credentials`. Existing rows are copied before the column is dropped; Prisma's generated migration would have dropped first and lost them.
- A new login role, `ventidoc_auth`, has only `SELECT, INSERT, UPDATE` on `user_credentials` and no privilege on any other table.
- `ventidoc_app` has **no** privilege on `user_credentials`, and `users` has no hash column.
- The API reaches hashes only through `CredentialStore`: a separate `pg` pool, four fixed parameterized statements. The ESLint rule `no-restricted-properties` bans `prisma.userCredential`.
- `loadConfig` refuses an `AUTH_DATABASE_URL` that isn't the `ventidoc_auth` role.
- Two connections can't share a transaction, so the order is fail-safe:
  - **Registration:** create the user, then the credential; delete the user if the credential write fails.
  - **Password reset:** revoke all sessions and stamp `password_changed_at` first, then swap the hash.
- `AuthGuard` now also rejects any session created before `password_changed_at`. That backstop covers a crash between the reset steps.

**Tests** (`test/security-gate.e2e-spec.ts`):
- `ventidoc_app` gets `permission denied` on read and update, including in platform scope.
- `ventidoc_auth` is denied on 7 other tables and on DELETE.
- Hashes are argon2id.
- Login, re-authentication, and reset (old password rejected, new one accepted, old sessions dead) work end to end.
- The stale-session backstop works.

**Residual risk.**
- The API process holds both connection strings. Remote code execution in the API, or leaked environment variables, still exposes the hashes (argon2id, 19 MiB, t=2).
- Full isolation needs a separate authentication service/process with its own credentials, or a secret manager that scopes `AUTH_DATABASE_URL` to the auth module's runtime.
- Medium severity. Recommended before handling regulated data; not a blocker for continued development.

## B. Wrong-tenant context: root cause, fix, and what remains

### Why RLS did not stop the write in the broken-guard experiment

1. The planted bug made `OrgAccessGuard` fabricate an `EffectiveAccess` for organization **B** carrying the requester's (organization **A** owner's) user ID.
2. `TenantDb.inOrg` dutifully ran `set_config('app.org_id', B)`, `set_config('app.user_id', A-owner)`.
3. Every tenant policy was `organization_id = app_current_org_id()`. The context *said* B, the rows *were* B's, so every check passed.
4. `app.org_id` is an ordinary setting the runtime role may set to anything, so RLS verified only that rows matched the declared context. **Nothing in the database asked whether the user in that context belongs to that organization.** RLS was a consistency check, not an authorization check.

### Fix: membership-bound RLS (migration `20261022120100_membership_bound_rls`)

- **SECURITY DEFINER helpers** (owned by `ventidoc_rls`, a `NOLOGIN BYPASSRLS` role, `search_path` pinned, EXECUTE revoked from PUBLIC):
  - `app_is_active_member()`
  - `app_invitation_ok()`
  - `app_tenant_ok()`
  - `app_org_has_members()`
  - `app_org_bootstrap_ok()`

  Owning them as a BYPASSRLS role avoids recursive policy evaluation on `organization_memberships`.
- **Business tables** (`products`, `stock_balances`, `stock_movements`) require the context user to be an **active member** of the context organization.
- **RBAC/administration tables, organizations, subscriptions and audit** require an active member, or, during invitation acceptance only, a **live invitation** that is all of:
  - for this organization;
  - matching the token hash in `app.invitation_token_hash`;
  - addressed to the context user's **verified** email.
- **Membership rows can only be inserted for the context user themself, and only via a verified invitation or by the creator of a brand-new organization with no members yet.** A wrong-tenant bug therefore can't enrol anyone into another organization.
- Suspended and revoked members lose database-level access, not just API access.
- Helpers are called as `(SELECT f())`, so PostgreSQL evaluates them once per statement, not per row.

### Verified

- **Planted bug re-run** (`OrgAccessGuard` bypass, same as the original experiment):
  - all write requests were refused;
  - B's 13-table fingerprint, including its audit log, was **unchanged** (previously it changed);
  - read endpoints returned `200` with **empty** results, and no B data appeared in any response.
  
  The sweep still fails on status codes, as it should, because the guard *is* broken. The guard was restored byte-for-byte afterwards.
- **`security-gate.e2e-spec.ts`**, run in B's context with A's owner as user (exactly what the bug produced):
  - every tenant table returns 0 rows;
  - UPDATE and DELETE affect 0 rows;
  - INSERT into products, roles and memberships fails;
  - a forged invitation hash fails;
  - a suspended member sees nothing;
  - `TenantDb.inOrgUnchecked(B, A-owner)` reads `[]` and updates 0.

### Connection pooling

- Settings are applied only with `set_config(…, is_local => true)` inside a transaction. `TenantDb` now writes **all four** context keys on every transaction (empty = unset), so nothing can survive from elsewhere.
- Tests prove the context is empty after both COMMIT and ROLLBACK on the same physical connection.
- After TenantDb transactions (including a failed one and a platform-scope one), 20 concurrent queries on the shared Prisma pool see no context and no tenant rows.
- Safe with PgBouncer in transaction mode; incompatible with *statement* mode, which would also break transactions.

### Fresh-database equivalence

A disposable database migrated from scratch from the committed migration files, the test database and the dev database produce identical hashes over 371 security objects: every policy, helper function (owner, definer flag, body), table grant and RLS flag. The disposable database was then dropped.

### Residual risk (documented, not fixed)

| Residual | Why it remains | Structural control |
|---|---|---|
| A bug that sets **both** a wrong organization **and** the user ID of a genuine member of that organization would still be served. | `app.user_id` is a setting the runtime role controls; the database can't authenticate the end user. | `app.user_id` is written only from `req.auth.userId`, which `AuthGuard` derives from a verified, unrevoked session. `TenantDb.inOrg` accepts only an `EffectiveAccess` from `OrgAuthzService`. Exploitation needs two independent bugs. Possible future step: bind the context to a session ID verified by a definer function. |
| SQL injection could call `set_config` directly. | Same as above. | All SQL is parameterized; `$queryRawUnsafe`/`$executeRawUnsafe` are lint-banned. Injection would also need a member's user ID. |
| Within a legitimately authorized organization, RLS doesn't enforce *permissions* (e.g. a cashier writing roles). | Permissions are application-level by design (the delegation rule, branch scope, overrides). | Centralized guards, the delegation rule, and the route-generated sweeps in CI. |
| `ventidoc_rls` bypasses RLS. | Needed to read memberships without policy recursion. | NOLOGIN, owns only five read-only `sql` functions, reachable only by `SET ROLE` from the migrator (which owns the schema anyway). |

## C. Outstanding work: severity and gating

| Item | Severity | Gate |
|---|---|---|
| MFA (TOTP + recovery codes; mandatory for platform admins and organization owners) | High | **Implemented in stage 2B** (uncommitted, under review): [mfa.md](mfa.md). Remains a release blocker until real email, KMS-held keys and two-person administrative reset exist (mfa.md §11). |
| Real transactional email for verification, reset and invitations (provider, SPF/DKIM, bounce handling) | High | **Release blocker** (accounts can't be verified without it) |
| Distributed (Redis) rate limiting + correct proxy trust / client-IP derivation | High | **Implemented in stage 2A** (uncommitted, under review): [rate-limiting-and-abuse-protection.md](rate-limiting-and-abuse-protection.md). Remains a release blocker until a production HA/TLS Redis and the real `TRUSTED_PROXIES` are configured. |
| Production configuration: secret manager, TLS to PostgreSQL and Redis, cookie domain, CORS origins, `NODE_ENV=production` acceptance tests | High | **Release blocker** |
| Step-up re-authentication for organization-level sensitive actions (ownership transfer, restricted-permission grants, exports, payroll approval) | Medium-High | **Release blocker for any module exposing restricted data**; required in Stage 2 |
| CI never executed on GitHub | Medium | **Blocker for the merge process** (run once a remote exists) |
| API process holds both DB credentials (hash exposure on RCE) | Medium | Later stage; required before regulated data |
| Lockout can be triggered by anyone who knows an email | Medium | **Fixed in stage 2A**: DB lockout removed; layered limits + recognized devices |
| Unlimited organizations/trials per user | Medium | Blocker for public self-service sign-up |
| Field-level DTO split; audit stores references, not values, for restricted resources | High when HR/payroll/finance ship | **Gate for those modules** |
| File, job, export and WebSocket isolation (mandatory tests 2 and 7) | High when built | **Gate for those features** |
| Support-access grants | n/a (feature absent = no access) | Before offering support access |
| Archiving products frees `limit.products` | Low | Product decision |
| Context bound to session ID (residual of B) | Low | Optional hardening |

## Tests at this gate

See the final verification run recorded in the initial commit message and in §"Verification" of `docs/architecture/06-implementation-plan.md`.
