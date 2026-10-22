# 6. Status, implementation plan, assumptions and open decisions

## 6.1 Stage 1 (secure foundation): status

| Completion criterion | Status |
|---|---|
| Architecture and data model documented | Done (docs 01–05, generated RBAC matrix) |
| Authentication foundation | Done: argon2id, email verification, reset, lockout, rate limiting, sessions, refresh rotation with reuse detection, web cookies + CSRF, mobile bearer tokens, step-up re-authentication. **MFA pending.** |
| Organization and branch membership models | Done, including invitations bound to email |
| Platform RBAC separated from organization RBAC | Done |
| Centralized, testable authorization | Done (registry + pure evaluator + guards + delegation rule) |
| Database tenant-isolation controls | Done (forced RLS, app role without bypass, composite FKs, append-only ledgers) |
| Automated cross-tenant denial tests | Done |
| Subscription entitlement design | Done, with branch/member/product limits and read-only mode enforced |
| Runs locally with documented instructions | Done (README) |

### Mandatory security tests (§9)

| # | Requirement | Where | Status |
|---|---|---|---|
| 1 | Org A can't access Org B | `tenant-isolation`, `rls` | ✅ |
| 2 | Files / signed links isolated | — | ⏳ with file storage |
| 3 | Branch-scoped users limited to their branches | `rbac`, unit | ✅ |
| 4 | Cashier can't run payroll/admin actions | `rbac`, unit (payroll endpoints not built; permission-level only) | ✅ partial |
| 5 | Role change / revocation is prompt | `rbac`, `auth` | ✅ |
| 6 | Client tenant IDs can't override authorization | `tenant-isolation` | ✅ |
| 7 | Search, reporting, exports, jobs, sockets, files isolated | search + audit ✅; others ⏳ with those features |
| 8 | No privilege escalation via bodies/IDs | `rbac`, `tenant-isolation` | ✅ |
| 9 | Subscription limits enforced by backend | `subscriptions` | ✅ |
| 10 | Concurrent stock ops keep balances valid | `stock` | ✅ |
| 11 | Platform admin ≠ business-data access | `platform`, `rls` | ✅ |
| 12 | Sensitive operations audited | `rbac`, `platform` | ✅ |

Security review 2026-10-22: 9 confirmed defects fixed (2 high-severity privilege issues, 1 high-severity platform data exposure), 2 hardening items; see [../security/2026-10-22-review.md](../security/2026-10-22-review.md), including the remaining limitations.

## 6.2 Prioritized next steps

1. **CI hardening**: the GitHub Actions workflow runs lint, typecheck, unit and integration tests and the migration guard against a Postgres service. Add dependency audit (`pnpm audit`), secret scanning, CodeQL, and branch protection.
2. **Review follow-ups**: move credential reads behind a `SECURITY DEFINER` function and revoke `password_hash` column access; require step-up for organization-level sensitive actions; cap organizations/trials per user; store references, not values, in audit events for restricted resources.
3. **Production prerequisites** (currently blocked by `loadConfig`): a real mail provider transport; production HA/TLS Redis and real `TRUSTED_PROXIES` for the Redis-backed rate limiter (implemented in stage 2A); TOTP MFA (enrolment, recovery codes, policy-enforced per org and mandatory for platform admins); structured logging with redaction; `TRUST_PROXY` configuration; secret-manager integration; cookie domain config.
4. **Web app** (Next.js): auth flows using cookies + CSRF header, org switcher, role editor driven by `GET /v1/permissions`, members/invitations, branches, products, stock. No business rules client-side.
5. **Mobile apps** (Flutter): shared API client generated from OpenAPI, refresh tokens in Keychain/Keystore via `flutter_secure_storage`, rotation handling, device naming for session management.
6. **Background jobs** (BullMQ on Redis): tenant-aware job envelope, re-authorization at execution, idempotent handlers; trial/grace expiry job; email sending via queue.
7. **File storage** (private S3-compatible): org-prefixed keys, short-lived signed URLs issued after permission checks, size/MIME validation, malware scanning hook, storage entitlements. Tests 2 and 7.
8. **Inventory completion**: categories, stock locations within branches, transfers (two-sided movements), adjustment approval workflow with separation of duties, suppliers and purchasing.
9. **Sales, payments, customers**, then **HR/payroll** (sensitive DTO split, approval ≠ preparer), **finance**, **reporting/exports** (audited, permission-gated, tenant-filtered).
10. **Real-time** (WebSockets): session-authenticated handshake, per-org rooms joined only after authorization, re-check on membership change.
11. **Support-access grants** (design in 04-rbac.md), ownership transfer, and account recovery workflow.
12. **Performance**: versioned per-membership permission cache invalidated in the same transaction as RBAC changes; pagination cursors on all lists.

## 6.3 Assumptions

- Organization slugs are globally unique and not secret.
- Login requires a verified email. Password reset also verifies the email (it proves inbox control) and signs out all sessions.
- New organizations start on a 14-day `starter` trial with 1 branch, 5 members and 200 products, and a "Main branch" is created automatically. Plan prices in the seed are placeholders.
- Members are added by **invitation** only (bound to the invited email, valid 7 days). Pending invitations count toward the member limit.
- Revoked members can be re-invited; suspended members must be reactivated by an admin.
- Removing someone's access requires holding the permissions they have, so admins can't sabotage more-privileged colleagues.
- One API instance for now (in-memory rate-limit counters).

## 6.4 Unresolved product decisions

1. Final plan catalogue, prices, currencies, trial length, and whether a free tier exists.
2. Retention period after cancellation and the data-deletion policy (also GDPR/NDPR obligations by market).
3. MFA policy: optional per user, enforceable per organization, mandatory for owners and platform admins?
4. Whether organization owners must approve every support-access grant, or platform security can approve emergency access.
5. Account recovery for organizations that lose their only owner.
6. Which actions require separation of duties beyond payroll (refunds above a threshold? stock adjustments above a value?), and the thresholds.
7. Multi-currency per branch vs per organization.
8. Hosting region(s), data residency, and the managed Postgres provider (affects RLS role setup and pooling mode).
