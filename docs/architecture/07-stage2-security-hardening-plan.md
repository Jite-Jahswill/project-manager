# Stage 2: security hardening plan

Baseline: commit `ff94238` (stage 1 foundation + security gate). The goal is to remove the four release blockers that are pure security work (security gate §C), so the `NODE_ENV=production` refusal in `src/config/env.ts` can be lifted **only** when each is done and tested. No frontend work in this stage.

## State before stage 2A (inspected 2026-10-22; rate limiting has since been replaced, see 2.1)

| Area | Today | Where |
|---|---|---|
| Mail | `MailService` with `log` / `capture` transports only; links carry the token in the URL fragment | `src/mail/mail.service.ts` |
| Rate limiting | `@nestjs/throttler` 6, in-memory storage, `default` + `auth` (per-IP) throttlers; `trust proxy` off unless `TRUST_PROXY=true` | `src/app.module.ts`, `src/bootstrap-app.ts` |
| Lockout | Per-account counter on `users` (5 failures → 15 min, doubling, 24 h cap) | `src/auth/auth.service.ts` |
| Step-up | `sessions.reauthenticated_at`, `POST /v1/auth/reauthenticate`; enforced only for privileged **platform** permissions (10-minute window); any fresh login counts | `src/authz/platform-access.guard.ts` |
| MFA | None | — |
| Redis | Container provisioned (`docker-compose.yml`, :6380, password), **no client dependency installed** | — |
| Credentials | `user_credentials`, `ventidoc_auth` role, `CredentialStore` | security gate §A |

Dependency policy (unchanged): pin exact versions published at least two weeks before installation; stay on the NestJS 11 line. As of today, `@nestjs/bullmq` 12, `nodemailer` 10.2.0, `bullmq` 6.4.0 and `@aws-sdk/client-sesv2` 3.1155.0 are either too new or target NestJS 12, so pin earlier releases. Check peer compatibility of `@nest-lab/throttler-storage-redis` with `@nestjs/throttler` 6 and the chosen `ioredis` major before adopting it; otherwise implement the four-method `ThrottlerStorage` interface directly (small, testable).

## Work items, in order

### 2.1 Redis foundation and distributed rate limiting (first: everything else depends on Redis): **implemented (stage 2A, commit `22e390f`)**: see [../security/rate-limiting-and-abuse-protection.md](../security/rate-limiting-and-abuse-protection.md)

- Add `ioredis` and a `RedisModule` (`REDIS_URL`, TLS option, connection health in `/health`). Fail closed when Redis is unreachable: refuse to serve credential endpoints rather than silently skip limiting.
- Redis-backed `ThrottlerStorage` (atomic `INCR` + `PEXPIRE` in a Lua script, block duration support).
- Limits keyed on **IP + normalized email** for login/reset/verify (stops one IP spraying many accounts *and* many IPs hitting one account), plus the existing per-IP limit.
- Client IP derivation: explicit `TRUST_PROXY` hop count / CIDR list, never "trust all"; unit-tested against spoofed `X-Forwarded-For`.
- Replace the hard account lockout with **progressive delay + per-account limit**, so an attacker can't lock a victim out by guessing; keep an audit event and alert threshold.

### 2.2 Transactional email: **implemented (stage 2C)**: see [08-email-platform.md](08-email-platform.md) and [../security/email.md](../security/email.md). Delivery uses a PostgreSQL outbox, not BullMQ/Redis (decision in 08 §8.3).

- `MailTransport` interface with a provider implementation (decision needed: Amazon SES, Postmark or SMTP via nodemailer) and the existing `log`/`capture` for dev and test.
- Send through a **BullMQ queue** (Redis from 2.1): retries with backoff, idempotency key per message, dead-letter on permanent failure. Requests never block on the provider.
- Templates for verification, reset, invitation, "sign-up attempt on your email", and new security notices ("password changed", "MFA disabled", "new sign-in").
- Webhooks for bounces/complaints → suppress the address, audit it. Verify webhook signatures.
- Deployment checklist: SPF, DKIM, DMARC on the sending domain; links built only from `APP_PUBLIC_URL` (never from request `Host`).

### 2.3 Multi-factor authentication (TOTP + recovery codes): **implemented (stage 2B, commit `5020cc6`)**: see [../security/mfa.md](../security/mfa.md). The design below was the plan; mfa.md is authoritative.

- Tables (migration + RLS/grants):
  - `user_mfa_factors (id, user_id, type, secret_encrypted, confirmed_at, last_used_step)` and `user_recovery_codes (user_id, code_hash, used_at)`.
  - Owned by the credential boundary: `ventidoc_auth` gets the privileges, `ventidoc_app` none, mirroring `user_credentials`.
- Secret encryption: AES-256-GCM with a key from `MFA_ENCRYPTION_KEY` (later a KMS), key-ID prefix for rotation.
- Flows:
  - **Enrol:** generate a secret, then confirm with a code.
  - **Login:** login returns an `mfa_required` challenge token (short-lived, single-use, bound to the user + client), then `POST /v1/auth/mfa/verify`. Only then is a session created.
  - **Recovery codes:** 10, single-use, shown once.
  - **Disable:** requires step-up and MFA; notification email.
- Replay protection: reject a TOTP step ≤ `last_used_step`. Rate-limit verification per challenge and per account.
- Policy:
  - mandatory for platform admins (block platform routes until enrolled);
  - per-organization `require_mfa` setting enforced in `OrgAccessGuard`;
  - mandatory for organization owners at release.
- `sessions.mfa_verified_at` for step-up decisions.

### 2.4 Re-authentication for sensitive actions

- Generalize step-up into a `@RequireStepUp({ maxAgeSeconds, mfa: boolean })` decorator usable on org and platform routes.
- Recent **explicit** re-authentication (password + MFA when enrolled) is required; a fresh login no longer counts for the most sensitive actions.
- Apply to:
  - ownership grant/removal;
  - granting RESTRICTED permissions (roles, assignments, overrides);
  - membership revocation of admins;
  - MFA/password changes;
  - privileged platform permissions;
  - later, exports and payroll approval.
- Route-guard test extension: every route that can grant a RESTRICTED permission must carry `@RequireStepUp` (structural test like `route-guards.e2e-spec.ts`).

### 2.5 Abuse cases and remaining gate items

- Cap organizations created per user and trials per verified email/domain (needs product numbers).
- Session limits per user; "sign out other devices" endpoint.
- Account-recovery workflow for an organization that lost its only owner (support-assisted, audited, delayed).

### 2.6 Tests (each item ships with its tests)

| Area | Tests |
|---|---|
| Rate limiting | Two API instances sharing Redis enforce one combined limit; spoofed `X-Forwarded-For` ignored without trusted proxy; per-account limit across many IPs; Redis outage fails closed |
| Lockout replacement | Attacker guessing can't lock out the real user who passes MFA / has a known device; delays grow; audit + alert emitted |
| Email | Queue retries and dead-letters; no token appears in logs or audit; bounce webhook signature verified and suppression enforced; links use `APP_PUBLIC_URL` even with a forged `Host` header |
| MFA | Enrol/verify/disable; replayed code rejected; recovery code single-use; challenge token expiry and single use; MFA-required org blocks non-enrolled members; platform routes blocked until enrolled; `ventidoc_app` can't read MFA secrets |
| Step-up | Each sensitive route rejects stale or missing step-up; fresh login alone insufficient where configured; structural route test |
| Recovery flows | Reset with MFA enrolled still requires second factor or recovery code; recovery codes regenerate invalidates old ones |
| Deployment configuration | `loadConfig` matrix: production refuses `log` mail, missing Redis, missing MFA key, wildcard CORS, non-TLS DB URL, `TRUST_PROXY=true` without hop count; an end-to-end boot test in production mode with all set |
| Regression | All stage-1 suites (115 integration + 33 unit) and the authorization sweeps stay green |

## Exit criteria for Stage 2

- All four security release blockers (MFA, email, distributed rate limiting, step-up) implemented with the tests above passing.
- `loadConfig` accepts `NODE_ENV=production` only with a production-grade value for every item, verified by the configuration test matrix.
- CI executed on GitHub (requires a remote; not authorized yet).
- Security gate document updated with re-classification.

## Decisions needed before starting

1. Email provider (SES, Postmark, or SMTP relay) and sending domain.
2. MFA policy: mandatory for owners and platform admins at release (recommended); optional or org-enforced for everyone else?
3. Organization/trial caps per user.
4. Which hosting environment fronts the API (determines the trusted-proxy configuration).

**Recommended first step:** 2.1 (Redis module + distributed rate limiting + client-IP derivation). It has no product decisions blocking it, and 2.2–2.4 build on it.
