# 8. Email platform (Stage 2C)

Status: implemented on top of `5020cc6`. Production sending is **disabled** and stays so until a provider and sending domain are verified and an administrator enables it (§7). See `docs/security/email.md` for the security model and operations.

## 8.1 Inventory before Stage 2C

| Flow | Call site | Sensitive content |
|---|---|---|
| Email verification link | `AuthService.sendVerification` | verification token |
| Password reset link | `AuthService.forgotPassword` | reset token |
| "Someone tried to register" notice | `AuthService.register` (existing email) | none |
| Organization invitation | `AccessControlService.invite` | invitation token |
| MFA first-enrollment code | `MfaService.startEnrollment` | 8-digit email code |
| MFA security notices (enabled, replaced, disabled, codes regenerated, recovery code used) | `MfaService.notify` | none |
| MFA recovery requested / executed | `MfaRecoveryService` → `MfaService.notifyUser` | none |

All were sent **synchronously** inside the request, through a dev-only `MailService` (log/capture). Known addresses did more work than unknown ones (the timing gap from Stage 2A).

## 8.2 Architecture

```
 auth / organizations / mfa  ──(typed EmailEvent)──►  EmailService.enqueue(tx?)
                                                          │  same DB transaction as the business change
                                                          ▼
                                            email_outbox (PostgreSQL, durable)
                                                          │  claim: UPDATE … FOR UPDATE SKIP LOCKED, lease
                                                          ▼
                     EmailWorker (inline in dev/test, or `pnpm api worker` process)
                       ├─ resolve event  (intent jobs look the user up NOW; tokens created by the auth subsystem)
                       ├─ settings + provider + secret  (read fresh each batch: no restart for config changes)
                       ├─ TemplateRenderer  (versioned DB templates, {{var}} only, escaping, locked security footer)
                       └─ ProviderAdapter.send  (resend | smtp | log | capture; registry, extension point)
                                                          │
                                                          ▼
                           email_delivery_attempts + outbox status (SENT / retry / FAILED / EXPIRED / DISCARDED)
```

| Concern | Component | Notes |
|---|---|---|
| Business events | `src/email/events.ts` (`EmailEvent` union) | Modules never call a provider; they enqueue typed events. |
| Durable queue | `email_outbox` + `EmailService` | Transactional outbox: written in the caller's transaction (invitations commit or roll back with the invitation). Redis is **not** involved, so a Redis outage loses nothing. |
| Delivery | `EmailWorker` | Polling with leases; multiple workers are safe (`SKIP LOCKED`); stale leases are reclaimed after a crash. |
| Templates | `email_templates` + `TemplateRenderer` | Admin-editable versions; the version used is recorded per job. |
| Providers | `src/email/providers/*` | `EmailProviderAdapter` interface; Resend (HTTP API) and SMTP (nodemailer) for real delivery; `log`/`capture` for development and tests only. |
| Configuration | `email_settings`, `email_providers`, `email_sender_identities`, `email_suppressions` | Platform-admin APIs (`/v1/platform/email/*`); environment variables only bootstrap. |
| Secrets | `email_provider_secrets` | `ventidoc_auth` role only; AES-256-GCM under `EMAIL_SECRET_KEYS` with provider-bound associated data. |
| Status & audit | `email_delivery_attempts`, `platform.email.*` audit events | Sanitized error summaries only. |

## 8.3 Key decisions

- **Outbox over a Redis queue.** The outbox row is the only copy that matters and it lives in PostgreSQL. The worker polls (default 1 s), so a Redis outage changes nothing for email. Wake-up signalling through Redis was deliberately left out: polling is simpler and has no failure mode to design for.
- **Intent jobs for account emails.** Verification and password-reset requests are enqueued as *intents* (`{ email }` or `{ userId }`). The worker resolves the user and asks the auth subsystem to create the single-use token at send time. The request path therefore does the same work for known and unknown addresses (the B9 timing gap), and no token is stored until it's needed.
- **Sensitive payload.** Invitation tokens and MFA setup codes must reach the recipient. They are stored AES-256-GCM encrypted (outbox-row-bound associated data) and wiped when the job reaches a terminal state. Passwords, TOTP codes, recovery codes, MFA secrets, access and refresh tokens never enter the outbox (a test enforces the event schema).
- **At-least-once, not exactly-once.** See `docs/security/email.md` §5. Resend idempotency keys make retries of an ambiguous send safe within Resend's idempotency window. SMTP has no idempotency, so a timeout after `DATA` can produce a duplicate.
- **Production sending is a runtime switch, off by default.** It can be enabled only when the active provider passed a configuration check and the default sender identity's domain is verified.
