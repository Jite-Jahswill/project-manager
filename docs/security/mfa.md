# Multi-factor authentication (Stage 2B)

Status: implemented and reviewed (§12). **Not production-ready**; see §11.

## 1. Threat model

| Threat | Control |
|---|---|
| Stolen or guessed password | A correct password for an MFA account yields only a 5-minute, single-use challenge; a session requires TOTP or a recovery code. |
| Attacker with the password enrolling *their* authenticator on an un-enrolled account | First enrollment needs a recent password step-up, **plus a one-time code emailed to the account** (inbox control), plus a valid TOTP from the new secret. |
| Online TOTP guessing (password known) | Per-user budgets: 5 / 15 min and 20 / 24 h (≈2 % chance per *year* of guessing, while the password stays compromised). Per challenge: at most 5 attempts. Per network: 60 / 5 min. A password reset ends the attack. |
| Lockout of the owner by that attacker | Recognized devices of the owner have their own challenge and verification budgets; a password reset restores the per-user budgets (review M-1). |
| Replay of an observed TOTP | The last accepted time step is stored per factor; a code is accepted only for a later step, via one conditional `UPDATE` (atomic). |
| Reuse of a recovery code (including concurrent requests) | Codes are consumed by one conditional `UPDATE … WHERE used_at IS NULL`; exactly one of N concurrent requests wins (tested with 8). |
| Database dump | TOTP secrets are AES-256-GCM encrypted under keys that aren't in the database; recovery codes are SHA-256 hashes of 80-bit random values. |
| SQL injection or query bug in tenant code | MFA tables are reachable only by the `ventidoc_auth` role; the application role gets `permission denied` (tested). |
| Ciphertext swapped between users | The user ID is bound as GCM additional authenticated data. |
| Bypass via refresh, mobile, alternate route or role change | See §4. |

Out of scope / residual:
- phishing proxies that relay a live TOTP (needs WebAuthn/passkeys);
- malware on the user's device;
- compromise of both the email inbox and the password before first enrollment.

## 2. Policy

| Who | MFA | Enforcement |
|---|---|---|
| Every **ACTIVE platform administrator** (platform RBAC: `platform_admins`) | **Mandatory** | `PlatformAccessGuard` requires an MFA-verified session for every platform permission; `AuthGuard` restricts un-enrolled admins to the enrollment allowlist. |
| Every **ACTIVE owner of an ACTIVE organization** (organization RBAC: Owner system role, org-wide) | **Mandatory** | `OrgAccessGuard` requires an MFA-verified session whenever `access.isOwner`; `AuthGuard` restricts un-enrolled owners. |
| Everyone else | Optional (self-service) | Once enabled, every login needs it; can be disabled with password + a fresh second factor. |

- The two RBAC systems are evaluated **separately**. `MfaPolicyService` reads `platform_admins` for the platform side and calls the database helper `app_current_user_owns_any_org()` for the organization side. That helper is `SECURITY DEFINER`, owned by `ventidoc_rls`, and returns only a boolean about the context user.
- The policy is evaluated on **every request** of a session that has no verified second factor, so being granted Owner or platform admin mid-session takes effect immediately (tested).
- Mandatory users **cannot disable** MFA. They can only replace their authenticator, which requires the current second factor.

**Allowlist for un-enrolled mandatory users** (`@AllowWithoutMfa`): `GET /v1/auth/me`, logout, session list/revoke, re-authenticate, and the MFA status and enrollment routes. Everything else returns `403 { code: "mfa_required" }`.

## 3. Lifecycle

| Operation | Route | Requirements | Effects |
|---|---|---|---|
| Status | `GET /v1/auth/mfa` | session | `enabled`, `required`, `sessionVerified`, `recoveryCodesRemaining`, `enrollmentPending` |
| Start enrollment | `POST /v1/auth/mfa/enrollment` | session + password re-entry within 10 min (a fresh login counts). Replacing an existing factor also requires the **current** TOTP or a recovery code. | New 160-bit secret stored encrypted as a *pending* enrollment (10 min). First enrollment: an 8-digit code is emailed. Response returns the secret and `otpauth://` URI **once**. |
| Confirm | `POST /v1/auth/mfa/enrollment/confirm` | `code` (TOTP from the new secret) + `emailCode` for a first enrollment; max 5 attempts, then the enrollment is discarded | Factor activated atomically, last step recorded, **10 new recovery codes returned once**, this session marked MFA-verified, **every other session revoked**, pending challenges voided, audit `auth.mfa.enabled`/`auth.mfa.replaced`, email notice. |
| Cancel | `DELETE /v1/auth/mfa/enrollment` | session | Pending enrollment deleted. |
| Regenerate recovery codes | `POST /v1/auth/mfa/recovery-codes` | MFA-verified session + password + fresh TOTP or recovery code | All old codes invalidated and new ones stored in one transaction; returned once; audit; email notice. |
| Disable | `POST /v1/auth/mfa/disable` | not mandatory for the user + MFA-verified session + password + fresh second factor | Factor, codes and enrollment removed; **other sessions revoked**; audit; email notice. |
| Administrative reset | `POST /v1/platform/users/:userId/mfa/reset` | see §8 | Factor removed, **all target sessions revoked**, challenges voided, audit, email notice. |

**TOTP:** RFC 6238, HMAC-SHA1, 6 digits, 30 s, which is what standard authenticator apps use. Generation is by `otpauth` 9.5.2 (verified against the RFC vectors in `src/mfa/mfa-primitives.spec.ts`). Comparison is constant-time over all candidates. **Clock drift: ±1 step (±30 s).** Codes are 6 digits only, and spaces or hyphens are ignored.

**Recovery codes:** 10 codes, `XXXX-XXXX-XXXX-XXXX` in Crockford base32 (80 bits each, CSPRNG), single-use. Input is case-, space- and hyphen-insensitive. Using one triggers an email notice with the remaining count.

Codes and secrets are **never** emailed, logged or audited. The only email in the flow is the 8-digit setup code.

## 4. Login state machine

```
                 POST /v1/auth/login (email + password; layered rate limits, Stage 2A)
                         │
          wrong password ├──────────────► 401 invalid_credentials (identical for MFA and non-MFA accounts)
                         │
            no MFA factor├──────────────► SESSION (mfa_verified_at = NULL)
                         │                   └─ if MFA is mandatory for the user: RESTRICTED (allowlist only, 403 mfa_required)
                         │                        └─ enroll + confirm ──► same session becomes MFA-verified
             MFA factor  ▼
              CHALLENGE  (opaque "vdmfa_…" token, SHA-256 stored in mfa_challenges, 5 min, ≤ 5 attempts,
                          bound to user + client type; no session, no access/refresh token, no cookies)
                         │  POST /v1/auth/mfa/verify { mfaToken, code | recoveryCode }
          wrong / replay ├──► 401 invalid_mfa (attempts++; dead after 5)
          expired / used ├──► 401 invalid_mfa
                         ▼
                 challenge consumed atomically ──► SESSION (mfa_verified_at = now) + device token
```

Invariants, each covered by tests in `test/mfa.e2e-spec.ts`:
- The challenge token is rejected as a bearer access token, as a refresh token, and on any API route.
- Web and mobile use the same two routes. Web receives cookies only after the second step; mobile receives tokens only after the second step.
- **Refresh** keeps the session's MFA state. A password-only session of an account that has MFA is refused by `AuthGuard` (401) and can't be refreshed (it's revoked on attempt).
- **Password reset** revokes all sessions and recognized-client tokens (Stage 2A), but **never** touches the MFA factor: the next login still requires the second factor.
- Enabling, replacing or disabling MFA revokes every other session of the user.

## 5. Storage and privileges

Migration `20261022150000_mfa_foundation`, purely additive:

| Object | Access |
|---|---|
| `user_mfa_factors` (encrypted secret, `last_used_step`) | `ventidoc_auth` only |
| `user_mfa_enrollments` (encrypted pending secret, SHA-256 of the email code, expiry, attempts) | `ventidoc_auth` only |
| `user_mfa_recovery_codes` (SHA-256 hashes, `used_at`) | `ventidoc_auth` only |
| `mfa_challenges` (token hash and metadata, no secrets) | `ventidoc_app` |
| `users.mfa_enabled_at` | Non-secret mirror for `AuthGuard`; `user_mfa_factors` is authoritative and the flag self-heals at login |
| `sessions.mfa_verified_at` | Second factor completed for this session |
| `app_current_user_owns_any_org()` | `SECURITY DEFINER` (owner `ventidoc_rls`), EXECUTE granted to `ventidoc_app` only |

The application accesses MFA tables only through `MfaStore`, a fixed-statement class on the `ventidoc_auth` pool shared with `CredentialStore`. ESLint forbids `prisma.userMfaFactor`, `prisma.userMfaEnrollment` and `prisma.userMfaRecoveryCode`.

## 6. Rate limits (all fail **closed** when Redis is unavailable)

| Policy | Subject | Default |
|---|---|---|
| `mfa.challenge.user` | user (unrecognized clients only) | 10 / 15 min |
| `mfa.verify.ip` | client network | 60 / 5 min |
| `mfa.verify.user` | user (unrecognized clients) | 5 / 15 min |
| `mfa.verify.daily` | user (unrecognized clients) | 20 / 24 h |
| `mfa.verify.device` | recognized client | 10 / 15 min |
| `mfa.enroll.user` | user | 10 / 1 h (start and confirm) |
| `mfa.manage.user` | user | 5 / 1 h (regenerate, disable) |
| `platform.privileged.user` | admin | 30 / 1 h (includes recovery requests and decisions) |
| `mfa_recovery.target` | target user | 3 / 24 h |

Verification buckets use reserve-then-refund: successes don't consume. During a Redis outage, MFA sign-in, regeneration and disablement return `503 temporarily_unavailable`; existing MFA sessions keep working (tested).

## 7. Encryption keys

- **Format:** `MFA_ENCRYPTION_KEYS="k1:<base64 32 bytes>[,k2:<base64 32 bytes>…]"`, `MFA_ENCRYPTION_ACTIVE_KEY_ID=k1`.
- **Ciphertext:** `v1:<keyId>:<iv>:<ct>:<tag>` (AES-256-GCM, 96-bit random IV, user ID as AAD).
- **Startup validation:** startup fails on missing keys, wrong length, duplicate IDs, or an active ID that isn't in the ring. Production also refuses CI or example keys.
- **Startup also refuses to run if any stored secret is sealed under a key ID missing from the ring** (review A-3), and `mfa:reencrypt` refuses to touch anything in that case. A key can't be retired by accident while still in use.
- **Separation:** separate from `JWT_ACCESS_SECRET`, `ABUSE_PROTECTION_SECRET` and the database credentials. Compromising one doesn't reveal another.
- **Rotation:**
  1. Add a new key to the ring and set it active. Existing ciphertexts stay readable.
  2. Each successful TOTP verification re-encrypts that user's secret under the active key (lazy).
  3. Run `pnpm api mfa:reencrypt` (`--dry-run` to only report) to re-encrypt the rest. It prints per-key counts, never secrets.
  4. Remove the old key **only** when the report shows no ciphertext under it.
  
  Tested end to end, including the CLI and signing in after the old key is retired.
- **Backups:** database backups contain only ciphertext. **Key material must be backed up separately, in the secret manager, for at least as long as the database backups that need it.** Restoring a backup without its keys makes every TOTP factor unusable: users fall back to recovery codes or administrative reset. Never store keys in the same backup as the database.
- **Compromise of a key:** add a new key, run `mfa:reencrypt`, remove the compromised key. Because an attacker with database access *and* the key could have read secrets, also require affected users to re-enroll (administrative reset plus notice).

## 8. Recovery and account loss

| Situation | Path |
|---|---|
| Lost phone, still has recovery codes | Sign in with a recovery code, then replace the authenticator (`POST /v1/auth/mfa/enrollment` with a recovery code) or regenerate codes. Tested. |
| Clock skew on the phone | ±30 s accepted; beyond that, fix the phone clock or use a recovery code. |
| Lost phone **and** recovery codes | **Two-person administrative recovery** (below). |

### Two-person administrative recovery

```
admin A: POST /v1/platform/mfa-recovery-requests {targetUserId, reason}        → PENDING (24 h), target emailed
admin B: POST /v1/platform/mfa-recovery-requests/:id/approve {targetUserId}    → APPROVED → executed → EXECUTED
admin B: POST …/:id/reject {note}  → REJECTED      admin A: POST …/:id/cancel → CANCELLED      (24 h) → EXPIRED
```

| Safeguard | Where enforced |
|---|---|
| Separate permissions: `platform.user_mfa.recovery.request` and `platform.user_mfa.recovery.approve` (both privileged) | `PlatformAccessGuard` |
| Both administrators: MFA-verified session, password re-entry within 10 min, per-admin rate limit | `PlatformAccessGuard` |
| Approver ≠ requester, approver ≠ target, requester ≠ target | API **and** database CHECK constraints (`mfa_recovery_second_person`, `mfa_recovery_not_self_target`) |
| Approver re-enters the exact target user ID they verified | conditional `UPDATE` (`recovery_target_mismatch`) |
| Target, requester, reason and expiry immutable; forward-only status transitions; a decision can't be reassigned | `BEFORE UPDATE` trigger `app_mfa_recovery_guard` |
| One open request per target; at most 3 requests per target per 24 h | partial unique index; `mfa_recovery.target` rate limit (fails closed) |
| Approval is single-use under replay and concurrency | one conditional `UPDATE … WHERE status = 'PENDING' AND expires_at > now() …` (tested with two simultaneous approvers) |
| Expiry 24 h (database cap 72 h) | CHECK + conditional update |
| Rows only in platform scope, never deleted | forced RLS; no DELETE privilege |
| Execution: factor, codes and enrollment removed; **all** sessions revoked; pending challenges voided | `MfaService.resetForRecovery` (idempotent; only the same approver can retry a failed execution) |
| Notices to the account holder at request **and** at execution, without administrator identities or secrets | email |
| Audit: `platform.mfa_recovery.requested/approved/rejected/cancelled/executed/execution_failed` | platform audit log |

Still a procedural requirement (not enforceable in code): the approver must verify the account holder's identity **out of band** before approving (e.g. a video call against identity documents, or confirmation by another owner of the user's organization), and record how in the reason or note.

## 9. Audit events

`auth.mfa.enrollment_started`, `auth.mfa.enrollment_failed`, `auth.mfa.enabled`, `auth.mfa.replaced`, `auth.login.mfa_challenge`, `auth.mfa.verification_failed`, `auth.login.succeeded` (with `secondFactor: totp|recovery`), `auth.mfa.recovery_code_used`, `auth.mfa.recovery_codes_regenerated`, `auth.mfa.disabled`, and the `platform.mfa_recovery.*` events (§8).

- These are identity events (`organization_id` NULL). RLS makes them invisible to organization members and administrators.
- Platform administrators see them in the platform audit log. They contain no organization business data and no secret material: a test scans every event of an MFA user for the secret, the codes and the recovery codes.

## 10. Configuration, development and CI

| Variable | Dev/test | Production |
|---|---|---|
| `MFA_ENCRYPTION_KEYS` | random key in `.env` (`openssl rand -base64 32`) | from a secret manager/KMS; never in a plain file or image |
| `MFA_ENCRYPTION_ACTIVE_KEY_ID` | `k1` | the newest key |

- **Development:** the setup code arrives in the API log (`MAIL_TRANSPORT=log`).
- **Tests:** they use the capture transport and the real enrollment flow (`enableMfa` in `test/support/harness.ts`).
- **CI:** CI carries a disposable `ci` key (refused in production).

## 11. Limitations and production blockers

1. **Email delivery isn't production-grade.** The first-enrollment email code and security notices depend on it (Stage 2C).
2. **Out-of-band identity verification** before approving a recovery is a written procedure only (§8). Two-person approval is enforced.
3. **MFA keys must come from a secret manager/KMS** with backup and rotation procedures in place (§7).
4. **TOTP is phishable.** WebAuthn/passkeys are the recommended next factor for administrators.
5. **No "remember this device for MFA" option.** Every login needs a second factor by design. Recognized-client tokens only affect rate-limit buckets.
6. **Response timing on the enrollment and MFA routes isn't constant**, and there's no device-name binding of challenges beyond client type.
7. **Owners who created organizations before Stage 2B** must enroll at their next request. Without working email in production, they can't complete the first enrollment.
8. **`sessions.reauthenticated_at` is set at login**, so a fresh login counts as step-up for starting enrollment. The emailed code is what blocks a password-only attacker.

The API still refuses `NODE_ENV=production`; `productionBlockers()` lists items 1–3.

## 12. Final review (2026-10-22, before commit)

Each finding was confirmed by a test failing on the unreviewed code (`test/stage2b-review.e2e-spec.ts`), then fixed.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| A-1 | High | One platform administrator could reset another user's MFA alone (account-takeover risk with a single compromised or malicious admin). | Two-person recovery (§8), enforced by the API and the database; the single-admin route and permission were removed (the seed prunes it). |
| A-2 | High | Pending MFA challenges survived a password reset. An attacker holding the old password and the second factor could complete a pre-reset challenge **after** the owner reset the password (the test produced a session). | The reset voids pending challenges in the same transaction; completion also refuses any challenge created before the last password change. |
| A-3 | Medium | Removing a key still in use from `MFA_ENCRYPTION_KEYS` made those users' MFA sign-ins fail at runtime. | Startup and the re-encryption CLI refuse an incomplete key ring. |
| A-4 | (verified) | Demotion and re-promotion of an owner. | Already correct: policy is re-evaluated per request (test added). |

The test harness now closes an app whose startup fails. Previously, a correctly refused startup left connections open and hung the test run.
