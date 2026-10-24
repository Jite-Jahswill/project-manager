# 9. Customer support (Phase 2)

Status: implemented in the API (`src/support/`, migration `20261024190000_customer_support`). No web UI. Security model, limitations and operations: [../security/support.md](../security/support.md).

## 9.1 Model

Support conversations belong to the **customer** (a user), not to an organization. A customer may attach one organization they are an active member of as context; this gives that organization **no** access. Organization owners, branch admins and every other tenant role have no support access at all. Staff access comes only from platform support permissions (§9.5).

| Table | Purpose | Notes |
|---|---|---|
| `support_conversations` | One conversation | `reference` (`SUP-XXXXXXXX`, safe for emails), subject, category, priority, status, assignee, `version` (optimistic concurrency), `message_seq` (last allocated number), last-message preview and times, read receipts (`customer_read_seq`, `support_read_seq`), notification coalescing counters |
| `support_messages` | Customer-visible messages | Numbered 1..n per conversation (`seq`), plain text, `client_message_id` idempotency key (unique per conversation and author). Append-only |
| `support_internal_notes` | Staff-only notes | Separate table, so customer queries and policies never touch it. Append-only |
| `support_assignments` | Assignment history | One row per change: from, to, by, reason. Append-only |
| `support_conversation_events` | Lifecycle history | CREATED, ASSIGNED, REASSIGNED, UNASSIGNED, STATUS/PRIORITY/CATEGORY_CHANGED, REOPENED, NOTE_ADDED. No message or note text. Append-only |
| `support_read_markers` | Per staff member read position | Customers use `customer_read_seq`. Monotonic (never moves back) |
| `support_attachments` | Attachment metadata | Bytes in object storage under a server-generated key; linked once to a message by its uploader |

Every table has FORCEd row-level security (§9.5). The database also enforces: valid status transitions, closed means closed, immutable identity columns, gap-free message numbering, who may change assignee/status/priority/category/read markers, append-only history, attachment key format and allowed types.

## 9.2 Lifecycle

| Status | Meaning |
|---|---|
| `NEW` | Created; no support reply yet |
| `OPEN` | Support is working on it |
| `PENDING_CUSTOMER` | Waiting for the customer |
| `PENDING_SUPPORT` | Waiting for support |
| `RESOLVED` | Support considers it solved |
| `CLOSED` | Terminal. Nothing changes any more; the customer starts a new conversation |

Rules (`src/support/lifecycle.ts`, mirrored by `app_support_status_transition_ok()`; a test compares both over all 36 pairs):

- A **support reply** moves any non-closed conversation to `PENDING_CUSTOMER`.
- A **customer message** moves `OPEN`/`PENDING_*`/`RESOLVED` to `PENDING_SUPPORT` (`NEW` stays `NEW`). A reply to a `RESOLVED` conversation **reopens** it (recorded as `REOPENED`). A message to a `CLOSED` conversation is refused (409 `conversation_closed`).
- The customer may explicitly reopen a `RESOLVED` conversation (`POST …/reopen`); nothing else.
- Staff with `platform.support.status.manage` may set any valid transition: `NEW → OPEN/PENDING_*/RESOLVED/CLOSED`, `OPEN ↔ PENDING_*`, `* → RESOLVED`, `RESOLVED → OPEN/PENDING_*/CLOSED`. `CLOSED` has no outgoing transitions.
- Priority (`LOW`, `NORMAL`, `HIGH`, `URGENT`) and category (`ACCOUNT`, `BILLING`, `TECHNICAL`, `FEATURE_REQUEST`, `OTHER`) change with `status.manage`. Customers choose the category at creation.

## 9.3 Concurrency and idempotency

- Every write that changes a conversation first locks its row (`SELECT … FOR UPDATE`). Message numbers, status changes and assignments are therefore serialized per conversation (tested with 10 concurrent sends: seq 1..11, no gaps).
- **Assignment** is compare-and-set: the request carries `expectedAssigneeUserId` (the assignee the administrator saw, `null` for the queue). If it changed, 409 `assignment_conflict` (tested with two concurrent assigners: one 200, one 409, one history row). Reassigning from one staff member to another requires a `reason`.
- **Status/priority/category** changes carry the conversation `version` (bumped by the database on each such change); a stale version gets 409 `version_conflict`.
- **Messages and notes** accept a client idempotency key (`clientMessageId` / `clientNoteId`). A retry with the same key and body returns the original (`duplicate: true`); the same key with a different body is 409 `idempotency_conflict`. Concurrent retries produce one message.

## 9.4 Real-time

**Transport: server-sent events** (`GET /v1/support/stream`, `GET /v1/platform/support/stream`), fanned out between API instances through Redis pub/sub. No WebSocket or real-time infrastructure existed. SSE was chosen over a new WebSocket gateway because it runs through the existing authenticated HTTP pipeline unchanged: the global `AuthGuard` (bearer or HTTP-only cookie, with session re-checks), the platform guard, CORS, and rate limits. It needs no new dependency or handshake authentication, and it removes cross-site WebSocket hijacking as a concern. Clients send through ordinary HTTP POSTs (idempotent). The event layer (`SupportRealtimeService`) is transport-independent if a WebSocket gateway is wanted later.

- **Authorization per event.** Each event carries the conversation's customer and current assignee. A stream delivers it only if its viewer may see the conversation at that moment: the customer, inbox staff, or the current assignee. Internal-note events go to staff with `platform.support.notes` only and never contain the note text. Customer copies of message events never include staff identities. After a reassignment, the previous agent receives only `{ access: "revoked" }`.
- **Revalidation.** Every `SUPPORT_STREAM_REVALIDATE_MS` (30 s), a stream re-checks its session (same rules as `AuthGuard`: revoked, expired, password changed, user suspended) and, for staff, their platform permissions. If either is gone, it sends `end` and closes. Bound: an access change takes effect on streams within that interval; on HTTP it applies to the very next request.
- **Not a source of truth.** Events are published only **after** the transaction commits. If publishing fails (Redis down) the change is still saved and the failure is counted and logged (`support.realtime_publish_failed`). Streams start with `ready { realtime: bool }` and send `ping` heartbeats (25 s).
- **Reconnect / catch-up (tested):** on reconnect, or when `realtime` is false, clients call `GET …/conversations` (ordered by last activity) and, for each open conversation, `GET …/messages?afterSeq=<last seq seen>`. Message numbers are gap-free, so a client knows exactly what it missed.

Events: `conversation.created` (staff), `conversation.updated`, `conversation.assigned`, `message.created`, `note.created` (staff with notes), `read.updated` (the reader's own other sessions), `ready`, `ping`, `end`.

## 9.5 Authorization summary

| Permission | Grants |
|---|---|
| `platform.support.inbox.read` | Every conversation, the unassigned queue, filters/search, metrics |
| `platform.support.assigned.access` | Conversations assigned to you; being assignable |
| `platform.support.assign` | Assign, reassign, unassign; list assignable staff |
| `platform.support.reply` | Reply (and upload reply attachments) where you have access |
| `platform.support.status.manage` | Status, priority, category where you have access |
| `platform.support.notes` | Read and write internal notes where you have access |
| `platform.support.attachments.read` | Download attachments where you have access |
| `platform.support.audit.read` | Conversation lifecycle history |

Roles: **Support agent** (assigned.access, reply, status.manage, notes, attachments.read; no inbox, no assign) and **Support administrator** (all support permissions). The Super administrator holds everything. Every platform route also requires an MFA-verified session. Support permissions are not "privileged" (no 10-minute password re-entry), because agents use them continuously. Enforcement layers: route guard (`RequirePlatformPermission` / `RequireAnyPlatformPermission`), then per-request row visibility in `SupportService`, then RLS through `app_has_platform_permission()`, which reads the caller's active platform roles (no session flag is trusted).

## 9.6 API contracts

All bodies are JSON unless noted. Lists use opaque keyset cursors (`nextCursor`; invalid → 400 `invalid_cursor`). Errors use the standard `{ statusCode, code, message }` shape. Not found and not visible are both 404.

### Customer: `/v1/support` (any authenticated user; own conversations only)

| Method and path | Body / query | Notes |
|---|---|---|
| `POST /conversations` | `{ subject ≤200, body ≤10000, category?, organizationId?, clientMessageId? }` | 201. Rate limit `support.conversation.user` (10/h, fails closed). `organizationId` must be an organization you are an active member of (400 `invalid_organization`) |
| `GET /conversations` | `?status&cursor&limit≤100` | Own conversations, newest activity first, with `unreadCount`, `lastMessagePreview` (never from notes) |
| `GET /conversations/:id` | | `assigned: bool` only (no staff identity, no priority: internal triage), `latestSeq`, `lastReadSeq`, `readBySupportUpToSeq` |
| `GET /conversations/:id/messages` | `?afterSeq` (catch-up, ascending) or `?beforeSeq` (history); `limit≤100` | `items`, `hasMore`, `latestSeq` |
| `POST /conversations/:id/messages` | `{ body, clientMessageId?, attachmentIds? (≤5, own unsent uploads) }` | 201 `{ duplicate, message, conversation }`. Rate limit `support.message.user` (60/5 min, fails open) |
| `POST /conversations/:id/read` | `{ upToSeq }` | 200 `{ lastReadSeq }` (monotonic, capped at latest) |
| `POST /conversations/:id/reopen` | | `RESOLVED` only; otherwise 409 `not_resolved` / `conversation_closed` |
| `POST /conversations/:id/attachments` | raw file bytes; headers `Content-Type`, `X-File-Name` (URL-encoded) | 201 metadata. Rate limit `support.upload.user` (30/h, fails closed). 413/415/400 on validation failures |
| `GET /attachments/:attachmentId/content` | | The file, as an attachment with inert headers |
| `GET /unread` | | `{ conversations, messages }` with unread support replies |
| `GET /stream` | | SSE (§9.4) |

### Staff: `/v1/platform/support` (MFA-verified platform administrators)

| Method and path | Permission | Notes |
|---|---|---|
| `GET /conversations` | inbox.read **or** assigned.access | Filters: `status` (comma list), `priority`, `category`, `assignee` (`me`, `unassigned`, staff id; anything but `me` needs inbox.read), `customerUserId`, `organizationId`, `q` (reference or subject text; wildcards literal), `sort` (`lastActivity`/`created`), `order`, `cursor`, `limit`. Agents always get only their own assignments |
| `GET /conversations/:id` | inbox.read or assigned.access | Staff view (customer, assignee, version, read receipts, `unreadCount`). Audited as a view |
| `GET /conversations/:id/messages` | inbox.read or assigned.access | Same paging as the customer route; includes author identities |
| `POST /conversations/:id/messages` | reply | As for customers. Moves to `PENDING_CUSTOMER` |
| `GET /conversations/:id/notes` · `POST …/notes` | notes | `{ body, clientNoteId? }` |
| `POST /conversations/:id/assignment` | assign | `{ assigneeUserId \| null, expectedAssigneeUserId \| null, reason? }` (§9.3) |
| `PATCH /conversations/:id` | status.manage | `{ version, status?, priority?, category? }` |
| `GET /conversations/:id/assignments` | inbox.read or assigned.access | Assignment history |
| `GET /conversations/:id/events` | audit.read | Lifecycle history |
| `POST /conversations/:id/read` | inbox.read or assigned.access | Own staff read marker |
| `POST /conversations/:id/attachments` | reply | As for customers |
| `GET /attachments/:attachmentId/content` | attachments.read | Audited |
| `GET /metrics` | inbox.read | Counts by status, unassigned active, oldest unassigned wait, urgent active, active per assignee |
| `GET /unread` | inbox.read or assigned.access | Unread customer messages in visible, non-closed conversations |
| `GET /assignees` | assign | Staff holding assigned.access |
| `GET /stream` | inbox.read or assigned.access | SSE (§9.4) |

## 9.7 Notifications

Through the Stage 2C email outbox, enqueued **in the same transaction** as the change (a failed or slow email never loses a message; tested with the worker stopped):

| Event | Recipient | When |
|---|---|---|
| `support.reply` | Customer | A support reply, coalesced: only if the customer has read everything up to the previous notification |
| `support.status_changed` | Customer | Resolved or closed |
| `support.customer_message` | Assignee | A customer message, coalesced against the support read position; none while unassigned |
| `support.assigned` | New assignee | Assigned to someone other than the actor |

Emails name only the public reference and link to the app. They never include message text, subjects, note content or staff names. Staff emails re-check at send time that the recipient still holds `platform.support.assigned.access`. There are no notification preferences in the codebase yet, so none are applied (§security 10).
