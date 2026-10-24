# Rate limiting and authentication-abuse protection (Stage 2A)

Status: implemented on top of commit `ff94238`; reviewed (§7); see §5 for verification.

## 1. What existed before (inspected 2026-10-22)

| Control | Implementation | Weakness |
|---|---|---|
| Global limit | `@nestjs/throttler` `default`, 600/min per `req.ip`, in-memory | Process-local: N instances allow N× the limit; lost on restart |
| Credential endpoints | `@nestjs/throttler` `auth`, 10/min per IP per route, in-memory (register, verify-email, resend, login, refresh, reauthenticate, forgot, reset) | Only an IP dimension: distributed guessing against one account and mail-bombing one victim from many IPs were unlimited |
| Account lockout | `users.failed_login_count` / `locked_until`: after 5 failures, 15 min lock doubling up to 24 h; checked before the password | **Lockout DoS**: anyone knowing an email could keep the victim locked out indefinitely. The response was generic, but the victim was still denied. |
| Re-authentication failures | Incremented the same DB lockout | A hijacked session could lock the account |
| Invitations (authenticated, sends mail) | Only the plan's member cap | Mail spam vector |
| Client IP | Express `trust proxy` = `1` when `TRUST_PROXY=true`, otherwise the socket address | Boolean trust: with `true`, any direct client could spoof `X-Forwarded-For` and pick its own rate-limit key |
| Redis | Compose service (password, 127.0.0.1:6380) and `REDIS_URL`; **no client, not used, absent from tests and CI** | — |

## 2. Design

### 2.1 Shared limiter (`src/abuse/rate-limiter.service.ts`)

- **Algorithm: GCRA** (generic cell rate algorithm, a token bucket). One Redis key per subject stores the "theoretical arrival time". A Lua script reads it, decides and writes it in one atomic step, using Redis `TIME`, so every API instance shares one clock and one count.
  - A policy "*N per P*" allows a burst of N, then one request per P/N.
  - `Retry-After` is exact.
  - Keys expire automatically when the bucket is full again (bounded memory, no cleanup job).
- **Keys**: `<prefix>:rl:<policy>:<HMAC-SHA256(secret, subject)[0..32]>`. Raw emails, IP addresses, user IDs and tokens never appear in Redis. The HMAC key is derived from `ABUSE_PROTECTION_SECRET`.
- **Policies**: named, with defaults in code (§3), overridable per environment via `RATE_LIMIT_OVERRIDES="login.ip=30/5m,forgot.email=3/1h"`. Unknown names or malformed values refuse to start.
- **Responses**:
  - Every limited request: `429`, body `{ code: "rate_limited" }`, and `Retry-After` in whole seconds. Which policy fired is never revealed.
  - Fail-closed outage: `503 { code: "temporarily_unavailable" }` with `Retry-After: 5`.
- The process-local `@nestjs/throttler` is **removed**, so there is no silent in-memory fallback.

### 2.2 Login: layered limits instead of account lockout

Every bucket is a **reservation**: taken *before* the password is verified, and **refunded** (atomically, never beyond a full bucket) when the password proves correct.
- Failures always count; successes never consume capacity.
- An owner's success never erases an attacker's earlier failures. (A first version deleted the bucket on success; corrected in review F-A, §7.)

| Layer | Subject | Default | Applies to | Stops |
|---|---|---|---|---|
| `login.ip_account` | client network + account identifier | 5 / 15 min | every attempt | one source guessing one account |
| `login.ip` | client network (IPv4 /32, IPv6 /64) | 30 / 5 min | unrecognized clients | one source spraying many accounts |
| `login.account` | account identifier | 20 / 1 h | unrecognized clients | distributed guessing (many sources, one account) |
| `login.device` | recognized-client token | 10 / 15 min | recognized clients | misuse of a stolen token |

- The **account identifier** is the HMAC of the normalized email, so unknown emails are limited exactly like real ones.
- **Recognized-client tokens: what they are.** After a successful login the client receives a signed token. Web gets it as an `HttpOnly`, `SameSite=Strict` cookie scoped to `/v1/auth`; mobile gets it in the response body, to send back on the next login.
  - **These are bearer tokens, not device-bound credentials.** Nothing ties them to hardware: whoever presents a copy is "recognized". They **grant no access**. They only select which login bucket applies, and a correct password is still required.
  - **Binding:** HMAC-SHA256 with an HKDF-derived key; bound to one user ID; bound to the user's **credential epoch** (time of the last password change).
  - **Revocation:** a password reset revokes every previously issued token. Rotating `ABUSE_PROTECTION_SECRET` revokes all tokens globally. Individual tokens can't be revoked.
  - **Validation:** strict claims (UUID user, 22-character device ID, integer timestamps), a 180-day expiry, and no other input (headers, IPs) consulted.
  - **Lifetime:** survives logout on purpose; never logged.
- **Why a victim can't be locked out:**
  - An attacker on another network never touches the victim's per-network buckets.
  - Returning clients skip the shared buckets entirely, so neither a distributed attack nor an insider on a shared address can lock them out.
  - Buckets refill continuously (`login.account` refills one attempt every 3 minutes); there is no long lock.
  - A password reset clears the per-account bucket.
- **Old DB lockout removed** from all code paths. `users.failed_login_count` and `users.locked_until` are kept but unused (deprecated; drop in a later, separately reviewed migration).
- **Trade-offs:**
  - A new device during an active distributed attack gets `429` until the bucket refills or the user resets their password.
  - A password reset also "forgets" the owner's own devices until their next successful login.
  - A stolen recognized-client token gives the thief at most `login.device` (10 / 15 min) for that single account, still behind `login.ip_account` per network, and it dies at the next password reset.

### 2.3 Other policies

See §3. In addition:
- Mail-sending endpoints are limited **per email** (anti mail-bombing) as well as per client.
- Re-authentication is limited per session and per user (no account lock).
- Invitations are limited per organization and per inviter.
- Privileged platform operations are limited per administrator.
- A coarse `default.ip` limit applies to every route.

### 2.4 Client IP (`src/abuse/client-ip.ts`)

- `TRUSTED_PROXIES` is an explicit list of proxy IPs/CIDRs (IPv4 and IPv6), **empty by default**.
- If the TCP peer isn't a trusted proxy, its address is the client and **all forwarding headers are ignored**.
- Otherwise `X-Forwarded-For` is walked **right to left**, skipping trusted proxies. The first untrusted address is the client.
- A malformed entry stops the walk, and the nearest trusted hop is used: it's safe, and at worst groups those clients together.
- `Forwarded`, `X-Real-IP` and every other header are never read.
- Express `trust proxy` is always off; `req.clientIp` is the single source, also used by audit events.
- Normalization:
  - IPv4-mapped IPv6 becomes IPv4;
  - zone IDs, brackets and ports are stripped;
  - IPv6 is written in canonical RFC 5952 form.
- **Rate-limit key**: IPv4 /32, IPv6 /64 by default (`RATE_LIMIT_IPV6_PREFIX`, 48–128). A /64 is normally one subscriber, and privacy addresses rotate within it. Per-account layers cover the case where many users share an address (carrier-grade NAT).
- The deprecated `TRUST_PROXY` variable is now **rejected at startup**, so a stale config can't silently trust everything.

### 2.5 Redis failure behavior

**Fail-open exceptions and why they're safe without Redis** (each covered by an outage test):

| Path | Protections that remain during an outage |
|---|---|
| `default.ip` (every route) | Capacity guard only. Every credential/mail endpoint has its own fail-closed policy; authenticated routes still require a valid session (DB-checked) and authorization; invalid JWTs are rejected before any DB work. |
| `POST /v1/auth/verify-email` | 256-bit random token, stored hashed, 24 h expiry, single-use (conditional consume); only effect is marking the email verified. Brute force is infeasible. Tested: an invalid token is rejected and a replay is rejected during an outage. |
| `POST /v1/invitations/accept` | Requires a session; 256-bit secret; invitation bound to the invitee's verified email (enforced by the app and by RLS); expiry; single-use; inviter re-authorized; member limit re-checked under the org lock. Tested during an outage: wrong user, forged secret and replay are rejected; issuing new invitations fails closed (503, no internal details). |
| `POST /v1/auth/refresh` | Requires a 256-bit refresh token; rotation with reuse detection revokes the session. |

Paths that send mail, verify a password, or create invitations all fail closed.


- `ioredis` with `enableOfflineQueue: false` (no unbounded queue), `maxRetriesPerRequest: 0`, a command timeout (`REDIS_COMMAND_TIMEOUT_MS`, default 250 ms) and capped reconnect back-off (≤ 2 s).
- After a failure, a 1-second circuit breaker fails fast instead of waiting on timeouts, which prevents retry storms and request pile-ups.
- Consequence: a single Redis stall longer than the command timeout makes fail-closed endpoints (sign-in, MFA verification) return 503 for about a second. This was observed once in local testing on an overloaded workstation running Redis in Docker (Redis's `SLOWLOG` showed 25–45 ms executions of a microsecond script). Production Redis needs dedicated CPU and latency monitoring; alert on `rate_limit.redis_unavailable`.
- Recovery is automatic on reconnect.
- **Per-policy failure mode** (§3):
  - **closed** returns `503` (credential and mail-sending endpoints, privileged operations);
  - **open** allows the request and logs it (requests that need a secret token or an existing session, and the coarse global limit).
- Structured, throttled warning logs: `rate_limit.redis_unavailable` with the policy, mode and count; never subjects, emails, IPs or tokens.
- `/health` reports `redis: up|down` and returns `status: degraded` (HTTP 200) when Redis is down. Taking every instance out of rotation would also stop the fail-open routes and existing sessions.
- **Consequence:** while Redis is down, **nobody can log in, register or request reset emails**. Existing sessions and token refresh keep working. Redis is therefore a hard dependency of authentication, and production needs a highly available Redis. The current compose Redis is single-node, without persistence, TLS or HA, and isn't production-grade.

## 3. Policies (defaults)

| Policy | Subject | Default | On Redis outage | Endpoint |
|---|---|---|---|---|
| `default.ip` | client network | 1200 / 1 min | open | every route |
| `login.ip` | client network (unrecognized clients; refunded on success) | 30 / 5 min | closed | `POST /v1/auth/login` |
| `login.ip_account` | network + email (refunded on success) | 5 / 15 min | closed | login |
| `login.account` | email (unrecognized clients; refunded on success) | 20 / 1 h | closed | login |
| `login.device` | recognized-client token (refunded on success) | 10 / 15 min | closed | login |
| `register.ip` | client network | 10 / 1 h | closed | `POST /v1/auth/register` |
| `register.email` | email | 3 / 1 h | closed | register |
| `verify_email.ip` | client network | 30 / 10 min | open | `POST /v1/auth/verify-email` |
| `resend_verification.ip` | client network | 10 / 1 h | closed | `POST /v1/auth/verify-email/resend` |
| `resend_verification.email` | email | 3 / 1 h | closed | resend |
| `forgot.ip` | client network | 10 / 1 h | closed | `POST /v1/auth/password/forgot` |
| `forgot.email` | email | 3 / 1 h | closed | forgot |
| `reset.ip` | client network | 20 / 1 h | closed | `POST /v1/auth/password/reset` |
| `refresh.ip` | client network | 600 / 5 min | open | `POST /v1/auth/refresh` |
| `reauth.session` | session | 5 / 15 min | closed | `POST /v1/auth/reauthenticate` |
| `reauth.user` | user | 10 / 1 h | closed | reauthenticate |
| `invite.org` | organization | 50 / 1 h | closed | `POST /v1/orgs/:orgId/invitations` |
| `invite.user` | inviter | 20 / 1 h | closed | invitations |
| `accept_invite.user` | user | 10 / 15 min | open | `POST /v1/invitations/accept` |
| `platform.privileged.user` | administrator | 30 / 1 h | closed | privileged platform permissions |
| `mfa.*` (7 policies) | see [mfa.md §6](mfa.md) | | closed | MFA challenge, verification, enrollment, management |
| `support.conversation.user` | user | 10 / 1 h | closed | `POST /v1/support/conversations` |
| `support.message.user` | user | 60 / 5 min | open | support messages, staff replies and notes |
| `support.upload.user` | user | 30 / 1 h | closed | support attachment uploads ([support.md §7](support.md)) |

## 4. Configuration

| Variable | Dev/test | Production requirement |
|---|---|---|
| `REDIS_URL` | `redis://:password@127.0.0.1:6380` | `rediss://` (TLS) with authentication (ACL user with only the commands the limiter needs: `EVALSHA`, `EVAL`, `DEL`, `PING`, `SCRIPT`), private network only, highly available (replica + failover); credentials from a secret manager |
| `ABUSE_PROTECTION_SECRET` | random ≥ 32 bytes | random ≥ 32 bytes from a secret manager; rotating it resets all buckets and invalidates device tokens |
| `TRUSTED_PROXIES` | empty | exactly the load balancer / reverse proxy addresses or CIDRs in front of the API, nothing broader; empty if clients connect directly. Ranges broader than IPv4 /8 or IPv6 /32 (and any /0) are refused at startup. Every address inside a listed range must be a proxy you control: a client inside a trusted range could otherwise prepend a spoofed hop. |
| `RATE_LIMIT_OVERRIDES` | tests raise limits | optional per-environment tuning |
| `RATE_LIMIT_IPV6_PREFIX` | 64 | 64 unless traffic data says otherwise |
| `RATE_LIMIT_KEY_PREFIX` | `vd` | per-environment value if Redis is shared |
| `REDIS_COMMAND_TIMEOUT_MS` | 250 | keep low (≤ 500) |

The hosting topology hasn't been chosen, so no provider-specific proxy ranges are assumed.

## 5. Verification

Tests (all against real PostgreSQL and a real Redis; the integration run aborts with `BLOCKED` if Redis is unreachable, instead of skipping):

| Suite | What it proves |
|---|---|
| `src/abuse/client-ip.spec.ts` | direct clients, trusted single/multiple proxies, spoofed and client-prepended headers, malformed/empty/missing values, IPv4/IPv6 normalization (mapped, zone IDs, ports, brackets, RFC 5952), /64 grouping, bounded header processing |
| `src/abuse/policies.spec.ts`, `src/abuse/device-token.service.spec.ts`, `src/config/env.spec.ts` | policy parsing, failure modes fixed in code, device-token tamper/expiry, config refusal of removed variables, trust-everything proxies and non-TLS production Redis |
| `test/rate-limiter.e2e-spec.ts` | shared limits across independent connections, exact counts under 400 concurrent requests from 4 instances, refill and expiry, HMAC'd bounded keys, connection-refused, hung-server timeout + circuit breaker, no pile-up under a 1000-request storm, automatic recovery |
| `test/abuse-protection.e2e-spec.ts` | no victim lockout (single-source and distributed attacks), recognized-device bypass and its limits, recovery via password reset, identical behavior for unknown emails, per-email mail limits, registration limits, spoofed headers ignored without trusted proxies, audit records the real client IP, re-authentication limits without account lock, organization limits only after authorization, privileged platform limit, global limit before authentication, 503/`Retry-After` on fail-closed endpoints during an outage, fail-open paths working, health `degraded`, recovery |
| `test/stage2a-review.e2e-spec.ts` | review findings F-A/F-B (shared-address sign-in, insider exhaustion, no failure wipe-out, token revocation on reset) and fail-open endpoint protections during a real outage |
| `test/route-guards.e2e-spec.ts` (+3) | every public state-changing route has an IP-keyed limit; the limiter guard is attached once per route (a double-charging bug found during this work); user/session limits only on authenticated routes |

## 6. Remaining risks

- **Redis is a hard dependency of sign-in.** Without an HA Redis, a Redis outage is a sign-in outage (by design: fail closed). Production needs a replicated, TLS, authenticated Redis; the local compose Redis is none of these.
- **Shared-address users** (carrier-grade NAT, offices, IPv6 /64 shared by many) share `login.ip` (30/5 min), `register.ip` and `forgot.ip`. Tune with `RATE_LIMIT_OVERRIDES` from real traffic.
- **Recognized-client tokens are bearer tokens.** They can't be revoked individually: a password reset revokes all of a user's tokens, and rotating `ABUSE_PROTECTION_SECRET` revokes everyone's. A stolen token only selects a rate-limit bucket; it grants no access.
- **No CAPTCHA or proof-of-work** step for anonymous high-volume abuse (e.g. registration from rotating residential proxies). Per-email limits bound the damage to any one victim.
- **Clock:** buckets use Redis server time; Redis failover to a replica with a skewed clock could briefly shorten or lengthen windows.
- `users.failed_login_count` / `locked_until` are deprecated but still in the schema (drop in a later migration).
- **Timing on mail endpoints.** Narrowed in stage 2C: `forgot` and `resend` now do one outbox insert for every address, and `register` hashes the password on both paths ([email.md](email.md) §6). New registrations still write two extra rows; no constant-time guarantee is claimed.
- **Unix-socket deployments** have no peer IP: every client shares the `unknown` bucket. Use TCP between the proxy and the API.

## 7. Review findings (2026-10-22, before commit)

Each finding was confirmed by a regression test failing on the unreviewed code (`test/stage2a-review.e2e-spec.ts`, plus unit tests), then fixed.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| F-A | High | `login.ip` counted successful logins: 31 colleagues behind one NAT address couldn't all sign in within 5 min, and one insider could exhaust the bucket for everyone there. `login.ip_account` was *deleted* on success, wiping an attacker's prior failures from a shared address. | Reserve-then-refund accounting (atomic Lua refund); recognized clients skip `login.ip`; no bucket deletion on success. |
| F-B | High | Recognized-client tokens survived password reset: anyone who had ever signed in (e.g. a past intruder) kept a bucket bypassing `login.account` for 180 days, even after the owner recovered the account. | Tokens bound to the credential epoch; any reset revokes them. |
| F-C | Medium | Documentation called the tokens device-bound; they're bearer tokens. | Wording corrected in code and docs (§2.2). |
| F-D | Medium | `TRUSTED_PROXIES` accepted ranges like `1.0.0.0/1`. | Minimum /8 (IPv4) and /32 (IPv6). |
| F-G | Low | Production would not refuse CI's disposable secrets/passwords. | Production blockers reject `ci-only`/`ci-`/example values for JWT, abuse secret and Redis password. |
| F-H | Low | Token claims weren't strictly validated. | Exact key set, UUID user, 22-character device ID, integer timestamps. |
| F-E | Low | Invitation limits were checked while holding the organization row lock. | Checked before the transaction (after `OrgAccessGuard` authorization). |
| F-F | Low | Public `/health` exposed limiter counters. | Removed; counters stay in internal logs. |

Fail-open endpoints were re-examined; they're justified and now covered by outage tests (§2.5). No finding remains open at critical or high severity.
