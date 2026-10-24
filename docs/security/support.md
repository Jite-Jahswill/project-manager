# Customer support: security model

Design and API contracts: [../architecture/09-support.md](../architecture/09-support.md).

**Status:** implemented in the API and tested against real PostgreSQL and Redis (`test/support.e2e-spec.ts`). **Not production-ready:** production mode is refused, among other reasons because attachments have no production storage driver yet (§6).

## 1. Principles

- Support conversations are owned by the **customer** (a user). They are never tenant data: no organization role can read them, and attaching an organization as context gives it no access.
- Staff access comes **only** from explicit platform permissions (`platform.support.*`). It is never inferred from a role's name.
- Internal notes are a separate table with separate policies. No customer query, policy, preview, event or email can reach them.
- Support never becomes a path around tenant isolation: support permissions grant no organization route or business table. The authorization matrix test sweeps every route against every role.

## 2. Authorization

| Who | Can |
|---|---|
| Customer (any authenticated user) | Create conversations; read, message, mark read, reopen (if resolved), upload and download only in **their own** conversations |
| Support agent (`assigned.access` + `reply`, `status.manage`, `notes`, `attachments.read`) | Only conversations **assigned to them**: read, reply, notes, status, attachments. No inbox browsing (`assignee=unassigned` → 403), no assigning (403), and other conversations → 404. Losing the assignment ends access on the next request |
| Support administrator (all support permissions) | Whole inbox, unassigned queue, metrics, assign/reassign, history |
| Custom roles | Exactly their permissions. For example, `inbox.read` alone can read but not assign, reply or see notes (tested) |
| Organization owners and other tenant roles | Nothing beyond their own customer conversations (tested at the API and the database) |

Enforced at three layers, on every request:

1. **Route guard:** `RequirePlatformPermission` / `RequireAnyPlatformPermission`, plus an MFA-verified session for every platform route.
2. **Service:** loads the caller's permissions per request (no cache) and applies row visibility (`staffCanSee`). Customer routes only reach the caller's own conversations, even for staff.
3. **Database:** RLS and triggers (§3).

Real-time streams apply the same visibility to every event (§9).

## 3. Database protections (migration `20261024190000_customer_support`)

- **FORCEd RLS on all 7 support tables.** Policies key on `app_current_user_id()` and on `app_has_platform_permission(key)`, a SECURITY DEFINER function owned by `ventidoc_rls` that reads the caller's ACTIVE platform roles. The database does not trust any "staff" session flag; tenant context (`app.org_id`) and platform scope grant nothing. The RLS lint test enforces this for `support_conversations`.
- **Conversation guard trigger:**
  - Identity columns (reference, customer, organization, subject, creation time) are immutable.
  - `CLOSED` is terminal.
  - Status transitions must be valid, and the caller must be permitted: customers may only move to `PENDING_SUPPORT`; staff may move to `PENDING_CUSTOMER` by replying, or anywhere with `status.manage`.
  - Changing the assignee needs `platform.support.assign`, and the new assignee must hold `platform.support.assigned.access`.
  - Priority and category need `status.manage`.
  - Read markers can only be moved by their own party; counters never decrease; messages are numbered one at a time.
  - `version` and timestamps are server-managed.
- **Messages:** `seq` must equal the number just allocated on the conversation. Customers cannot post as staff (RLS). Messages, notes, assignments and events are **append-only** (no UPDATE/DELETE privilege, plus mutation triggers).
- **Attachments:** the storage key must match `support/<uuid>/<uuid>` (no client path); content type must be on the allowlist; the size is bounded; only the uploader can link a file, once, to their own message, in the same conversation (composite foreign key).

Each of these is exercised with direct SQL as the runtime role in `test/support.e2e-spec.ts`.

## 4. Privacy

- **Customers never see staff identities or internal triage.** Replies show `authorKind: STAFF` only; the customer view shows `assigned: true|false` rather than who, and omits priority and the version counter (API and stream). Staff see customer name and email.
- **Previews** (`lastMessagePreview`) come only from customer-visible messages.
- **Emails** carry the public reference and a link, never message text, subjects, notes or staff names (§8).
- **Audit events** for support never carry `organization_id`. Organization members can read audit rows tagged with their organization, so support activity must not be tagged. They hold ids and counts, never message or note text (tested).
- **Logs** contain event names and ids only. Message bodies, notes, file contents and credentials are not logged.

## 5. Content safety

Messages and notes are **plain text**, stored and returned verbatim as JSON strings (≤10,000 characters, not blank, unknown fields rejected). The API never renders them as HTML. **Clients must render them as text** (never `innerHTML`). This is a requirement on the future web and mobile UIs. Subjects are plain text as well.

## 6. Attachments

- Uploads are raw request bodies (no multipart parser) with `Content-Type` and `X-File-Name`.
- The hard limit is **10 MB**, enforced while reading the body (413).
- Allowed types: PNG, JPEG, GIF, WebP, PDF and plain text. The declared type must be on the list (415) **and match the file signature**: an executable declared as PDF, or HTML declared as an image, is rejected. SVG and HTML are never accepted.
- File names are reduced to the last path segment, with control characters removed and a 200-character cap. They are used only in `Content-Disposition` (RFC 6266/5987), never in a path.
- The authorization check runs before anything is stored. Keys are generated by the server; if the database write fails, the stored object is removed.
- **Downloads are authorized on every request.** The customer gets their own uploads and anything sent in their conversation; staff need `attachments.read` plus visibility, and their downloads are audited.
- Response headers: `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store`. Storage keys and paths never appear in responses.
- **Not done:** no malware scanning, and image metadata (EXIF) is not stripped.

**Storage: only a development/test driver exists.** No S3-compatible storage was present in the repository. `AttachmentStorage` is the adapter interface. `LocalDiskAttachmentStorage` writes under `SUPPORT_STORAGE_DIR` (git-ignored, mode 0600, never overwrites, refuses keys outside the root) and is refused in production. **To configure (not done):**

1. An S3-compatible driver: private bucket, no public ACLs, server-side encryption.
2. Downloads either proxied by the API (as now) or through presigned GET URLs valid for about 60 s, issued only after the same authorization check.
3. Lifecycle rules for orphaned unsent uploads.
4. Backups aligned with database backups.

Until then, `productionBlockers()` keeps production mode refused.

## 7. Rate limits (existing distributed limiter)

| Policy | Default | Redis down |
|---|---|---|
| `support.conversation.user` | 10 per hour | **closed** (503): creates durable records and staff work |
| `support.upload.user` | 30 per hour | **closed** (503): storage abuse |
| `support.message.user` (customer messages, staff replies, notes) | 60 per 5 min | open: session-bound, and emails are coalesced |

Plus the global per-IP limit. Override per environment with `RATE_LIMIT_OVERRIDES`.

## 8. Notifications

- Enqueued in the Stage 2C outbox in the same transaction as the change, so a message is never lost because email failed (tested).
- **Coalesced:** one reply email until the customer reads; one customer-message email until support reads. This also keeps notifications idempotent under client retries, since messages themselves are idempotent.
- Staff recipients are re-checked at send time.
- Content-free, as described in §4.
- Notification preferences do not exist in the codebase yet; when added, they must be consulted before enqueueing.

## 9. Real-time

- **Authentication:** server-sent events through the normal HTTP pipeline (§9.4 of the architecture doc). Unauthenticated → 401; staff routes without support permissions → 403.
- **Authorization:** every event is checked against the viewer's current visibility. A reassignment removes access for the next event; the previous agent receives only `access: revoked`.
- **Revalidation:** streams re-check the session and permissions every 30 s and end on revocation, logout, password change, suspension or role removal (tested).
- **Delivery:** Redis pub/sub carries notifications of committed changes only. A lost event is recovered through the API (`afterSeq`), and the fallback is tested with an instance whose Redis is unreachable.

## 10. Remaining limitations

- **Production storage** for attachments (§6): a production blocker.
- **Retention and deletion:** support data has no retention period or erasure workflow. Foreign keys are `RESTRICT`, so users with support history cannot be hard-deleted; a GDPR/NDPA erasure process must anonymise rather than delete. Define retention with legal and data-protection advice.
- **Notification preferences:** not implemented (§8).
- **Malware scanning and EXIF stripping:** not implemented (§6).
- **Real-time access-change bound:** up to the revalidation interval for a role change on an *open stream*. Assignment changes and every HTTP request are immediate.
- **SSE through proxies:** production load balancers must allow long-lived responses and must not buffer `text/event-stream`. A WebSocket gateway can be added on top of `SupportRealtimeService` if needed.
- **Staff can see customer emails.** That is intended for support. Agents see them only for conversations assigned to them.
- **Support "settings"** (canned replies, SLAs, routing rules) do not exist. When added, changes must be audited and use privileged (step-up) permissions.
