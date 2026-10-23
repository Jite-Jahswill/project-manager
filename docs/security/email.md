# Email platform: security model and operations (Stage 2C)

Architecture: [docs/architecture/08-email-platform.md](../architecture/08-email-platform.md).

**Status:** implemented and tested against a local Resend API stand-in and a real local SMTP server. **No real provider delivery has been performed. `mail.havehub.com.ng` is not verified. Production sending is OFF.**

## 1. What modules can and cannot do

- Authentication, organization and MFA code calls only `EmailService.enqueue(event, tx?)` with a typed `EmailEvent`. Nothing outside `src/email/` imports a provider.
- `enqueue` writes one `email_outbox` row, in the caller's transaction when one is passed (invitations). There's no network call and no Redis.
- Events can't carry passwords, TOTP codes, recovery codes, MFA secrets, or access or refresh tokens (`src/email/templates.spec.ts` enforces this on the type definitions).
- One-time link tokens (invitations) and the MFA email setup code are the only secrets that travel. They go AES-256-GCM encrypted (`EMAIL_SECRET_KEYS`, associated data = outbox row ID) and are wiped when the job reaches a terminal state.
- **Verification and password-reset emails are intents.** The request stores `{ email }` or `{ userId }`. The worker resolves the account and asks the auth subsystem (`ActionTokenService`) for the single-use token at send time, then stores it encrypted for retries. Templates never create, alter or validate tokens.

## 2. Delivery guarantees

- **At-least-once.**
  - Each job is claimed by exactly one worker at a time (`FOR UPDATE SKIP LOCKED` plus a lease).
  - A worker that dies mid-send leaves a lease that expires. The next worker records the interrupted attempt as `AMBIGUOUS`/`worker_lost` and sends again.
- **Not exactly-once.**
  - If a provider accepts a message but the response never arrives (timeout or dropped connection), the outcome is unknowable.
  - **Resend:** every attempt of a job reuses the same `Idempotency-Key` (`vd-<job id>`), so Resend de-duplicates retries within its idempotency window (documented by Resend as 24 hours; confirm in their current docs). This bounds duplicates; it can't be made absolute.
  - **SMTP:** has no idempotency. A timeout after `DATA` is recorded as `AMBIGUOUS` and retried, which can produce a **duplicate email**. A stable `Message-ID` (`<vd-…@ventidoc.email>`) lets mailbox providers de-duplicate when they choose to.
- **Retries:** bounded exponential back-off with equal jitter ([d/2, d], d = min(max, base·2^(n−1))). Defaults are 8 attempts, 30 s base and 1 h cap, all configurable.
- **Failure classes:**
  - *retryable:* refused connections, 429, 409, 5xx, SMTP 4xx;
  - *permanent:* 4xx validation and authentication errors, SMTP 5xx, TLS/certificate errors; these dead-letter immediately as `FAILED`;
  - *ambiguous:* the outcome is unknown; retried as described above.
- **Expiry** per event type: verification 24 h, reset 1 h, invitation 7 d, MFA setup code 10 min, notices 7 d. Expired jobs become `EXPIRED` unsent; tokens also expire in the database.
- **Controlled administrative retry:** `FAILED` jobs whose content hasn't expired can be retried (`POST /deliveries/:id/retry`, audited).
- **Content wiping:**
  - `SENT`, `DISCARDED`, `EXPIRED` and `CANCELLED`: wiped immediately;
  - `FAILED`: kept until expiry, so it can be retried.
- **Sending cap:** `maxSendsPerMinute` (default 120), counted from delivery attempts in PostgreSQL across all workers.
- **Redis isn't used by email at all.** A Redis outage doesn't stop delivery (tested). The rate-limited request endpoints that *create* emails still fail closed as in Stage 2A.

## 3. Platform-admin API (`/v1/platform/email`)

Every route requires an MFA-verified platform session. **Privileged** routes also require a password re-entry within 10 minutes and are rate-limited per administrator.

| Permission | Privileged | Routes |
|---|---|---|
| `platform.email.read` | | `GET /config`, `GET /templates`, `GET /templates/:key/versions/:v`, `POST /templates/:key/preview`, `GET /audit-events` |
| `platform.email.configure` | yes | `PATCH /settings`, `POST /sending`, `POST /providers`, `PATCH /providers/:id`, `POST /providers/:id/activate`, `POST /providers/:id/check`, `POST/PATCH /sender-identities…`, `POST /sender-identities/:id/attest-domain` |
| `platform.email.secrets.manage` | yes | `PUT /providers/:id/secret`, `DELETE /providers/:id/secret` |
| `platform.email.templates.manage` | yes | `POST /templates/:key/versions`, `POST /templates/:key/versions/:v/activate` |
| `platform.email.deliveries.read` | | `GET /deliveries`, `GET /deliveries/:id`, `GET /metrics`, `GET /suppressions` |
| `platform.email.deliveries.manage` | yes | `POST /deliveries/:id/retry`, `POST /deliveries/:id/cancel`, `POST /suppressions`, `DELETE /suppressions/:id` |
| `platform.email.test_send` | yes | `POST /test-send` |

- Platform role **Email operations** has every email permission **except** `secrets.manage`. Super administrator has all.
- **Secrets are write-only.** Responses show `secretConfigured` and a safe hint: `re_…1234` for Resend, `configured` for SMTP. Secrets never appear in responses, audit events, outbox rows, logs or error summaries; provider errors are sanitized, and `re_…` keys, bearer tokens and the configured secret are redacted.
- **Changing the active provider's settings or credential sets its status to `UNVERIFIED` and turns production sending off**, until a new `check` passes.
- **Enabling production sending** requires all of the following (`409 email_not_ready` otherwise):
  - an active real provider (Resend or SMTP) whose last check passed;
  - its credential configured;
  - a default sender identity whose domain is verified, by Resend's domain API for Resend, or by an audited administrator attestation for SMTP (SMTP can't check DNS).
- **Test sends** go only to the requesting administrator's own address or an allow-listed `testRecipients` address. They work while production sending is off, so a configuration can be validated before activation.
- **Delivery views** expose operational metadata only: status, attempts, sanitized error, provider message ID, organization ID, and a masked recipient (`j***@domain`). Never the payload or message content.
- **Audit:** every configuration change is audited as `platform.email.*` (non-secret before/after values).

## 4. Templates

- **Versioned** (`email_templates`): one `ACTIVE` version per key, enforced by a partial unique index. Every job records the version it used.
- **Syntax is `{{variable}}` only.** Logic, helpers, `${}`, ERB-style tags and unknown variables are rejected.
- **Rendering safety:**
  - every variable is HTML-escaped in HTML and stripped of control characters;
  - subjects can't contain line breaks (header injection);
  - URL variables must be http(s).
- **Rejected HTML:** scripts, event handlers, `javascript:`/`vbscript:`, data URLs in attributes or CSS, forms, iframes, objects, embeds, `<base>`, `<meta>`, `<link>`, SVG/MathML.
- **Required variables** (the link or code) must remain in both the text and HTML versions.
- **Locked security footers** are appended by the system to every template and can't be edited or removed.
- **Preview** renders sample values only, never real tokens.

## 5. Tenant safety

- **`email_outbox` and `email_delivery_attempts` have forced RLS:**
  - rows can be enqueued with no organization (identity mail), by a verified member of *that* organization, or in platform or worker scope;
  - **no tenant context can read any row**, its own included;
  - only the delivery worker (`app.email_worker`) and platform administrators (metadata via the API) can read them.
- **Configuration tables** are readable by the platform and the worker, and writable only in platform scope.
- **Provider credentials** sit in `email_provider_secrets`: `ventidoc_auth` only. The application role gets `permission denied` (tested).
- **No company content in the platform audit log.** Email audit events hold configuration metadata only.
- **Tested:** an organization context reads 0 outbox and attempt rows and can't enqueue for another organization. Platform delivery views carry no content.

## 6. Generic responses and timing (B9)

`POST /v1/auth/password/forgot`, `/verify-email/resend` and `/register` return identical status and body for registered and unknown addresses (tested), with identical rate limits (Stage 2A).

- **Forgot password and resend:** the request path now does exactly one outbox insert for **every** address. Account lookup, token creation and auditing happen in the worker.
- **Register:** both paths compute one argon2id hash and insert one outbox row. A new address additionally creates the user and credential rows (a few milliseconds against tens of milliseconds for argon2), so the timing is not perfectly equal.
- No constant-time guarantee is claimed; the difference hasn't been measured statistically in a production-like environment.
- Queue status (`DISCARDED` for unknown addresses) is visible only to platform administrators with `deliveries.read`, never to the requester.

## 7. Keys, rotation, backups

- **Keys:** `EMAIL_SECRET_KEYS="e1:<base64 32 bytes>[,e2:…]"` with `EMAIL_SECRET_ACTIVE_KEY_ID`, a ring separate from the MFA keys. The same AES-256-GCM implementation is used (`src/common/keyring.ts`).
- **Startup refuses** a ring missing any key still used by a stored provider secret or queued message.
- **Rotating the encryption key:** add a key and make it active. Then re-save each provider secret through the API, which re-encrypts under the active key. Queued messages drain or expire within at most 7 days. Retire the old key only after that, since startup refuses to run otherwise.
- **Rotating a provider credential** (e.g. a new Resend key):
  1. Create the new key in the provider dashboard.
  2. `PUT /providers/:id/secret`. This turns sending off.
  3. `POST /providers/:id/check`, then `POST /sending {enabled:true}`.
  4. Revoke the old key at the provider.
- **Backups:** database backups contain only ciphertext. **Back up `EMAIL_SECRET_KEYS` (and `MFA_ENCRYPTION_KEYS`) separately, in the secret manager, for at least as long as the database backups that need them.** A restore without matching keys loses provider credentials (re-enter them) and queued one-time messages, which users then simply request again.

## 8. Resend and `mail.havehub.com.ng`: manual steps (not yet done)

> The domain is spelled `havehub` as requested. Confirm it isn't meant to be `havenhub` before adding DNS records.

1. Create a Resend account and team; enable MFA on it.
2. **Add the domain** `mail.havehub.com.ng` in Resend. Pick the region Resend offers closest to your users; confirm the current list in their dashboard.
3. **Publish the DNS records exactly as Resend shows them.** Typically:
   - a DKIM TXT record;
   - an SPF TXT record and an MX record on a sending/bounce subdomain;
   - optionally a tracking CNAME.
   
   Don't copy values from anywhere else. No values are assumed here.
4. **DMARC:** publish `_dmarc.mail.havehub.com.ng` (or on the organizational domain) starting with `v=DMARC1; p=none; rua=mailto:<reports address>`. Tighten it to `quarantine` and then `reject` after reviewing reports.
5. Wait for Resend to show the domain as **verified**.
6. Create an API key **restricted to sending** for production. A full-access key is needed only for `check` to read domain status: create it temporarily, or have an administrator check the dashboard.
7. **In Ventidoc, as a super administrator** (MFA plus a recent password re-entry):
   1. `POST /providers {kind:"RESEND", name:"resend"}`
   2. `PUT /providers/:id/secret`
   3. `POST /providers/:id/check`, which must show `domainVerified: true`
   4. `POST /providers/:id/activate`
   5. `POST /test-send` to your own address; inspect headers (SPF/DKIM/DMARC pass) and spam placement
   6. Only then: `POST /sending {"enabled": true}`
8. **Gradual activation:** start with a low `maxSendsPerMinute`, watch `GET /metrics` and `GET /deliveries?status=FAILED`, then raise it.
9. **Bounces and complaints:**
   - Add hard-bounce and complaint addresses to the suppression list (`POST /suppressions`). Suppressed recipients are never sent to.
   - Automated ingestion of Resend's signed webhooks is **not implemented yet** (next step), so until then review the Resend dashboard regularly.

**SMTP alternative:**
- Configure `host`, `port`, `security: starttls|tls`, `verifyCertificate: true` (always, in production) and `username`, and set the password via `PUT /secret`.
- Run `check`, then attest SPF/DKIM/DMARC for the sender domain (`POST /sender-identities/:id/attest-domain`, audited), then enable sending.
- Plaintext SMTP and disabled certificate verification are refused in production. STARTTLS is required, never opportunistic.

## 9. Configuration

| Variable | Purpose |
|---|---|
| `EMAIL_SECRET_KEYS`, `EMAIL_SECRET_ACTIVE_KEY_ID` | Encryption keys (secret manager in production) |
| `EMAIL_WORKER_MODE` | `inline` (API also delivers), `external` (run `pnpm api worker`), `off` |
| `EMAIL_WORKER_POLL_MS`, `EMAIL_WORKER_LEASE_MS`, `EMAIL_WORKER_BATCH` | Worker tuning (defaults 1000 ms, 60 s, 10) |
| `EMAIL_SUGGESTED_SENDER` | Seed only: the initial, **unverified** sender identity (default `no-reply@mail.havehub.com.ng`) |
| `EMAIL_BOOTSTRAP_DEV_PROVIDER` | Development/test only (`LOG`/`CAPTURE`); ignored in production |

Everything else (provider, credentials, sender identities, templates, retry policy, caps, test recipients, suppressions) is managed through the admin API. The removed `MAIL_TRANSPORT` and `MAIL_FROM` variables are refused at startup.

## 10. Remaining work and risks

- **Real delivery is unverified:** no Resend account, DNS records or deliverability test exist yet.
- **No automated bounce/complaint processing:** Resend webhooks with signature verification are still to build.
- **SMTP duplicates are possible** on ambiguous timeouts.
- **Register-path timing** differs slightly between new and existing addresses (§6).
- **Provider credentials** must move to secret-manager-held keys in production; administrators still see masked hints.
- **No production platform-admin UI exists yet;** these APIs are its contract.
