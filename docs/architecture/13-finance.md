# 13. Finance: expenses, cash movements and summaries (Phase 6)

Code: `src/finance/`. Migration `20261030090000_finance`. Tests: `test/finance.e2e-spec.ts`, `src/finance/finance-common.spec.ts`, the authorization sweeps (`test/authorization-matrix.e2e-spec.ts`, which seed and fingerprint every finance table), RLS (generated over all tenant tables) and the role-template tests (template version 4).

All routes are under `/v1/orgs/:orgId` and follow [10-organizations.md §10.1](10-organizations.md):
- membership plus permission;
- 404 for records the caller cannot see, 403 when they can see a record but may not act on it;
- unknown body fields rejected;
- `version` for optimistic concurrency;
- audit events in the same transaction.

## 13.1 Scope and sources of truth

Phase 6 adds **expenses** (with categories, approval and attachments) and **operational cash movements**, and **reports** over those and over the existing sales records. It does not duplicate any existing record:

| Figure | Authoritative source | Never |
|---|---|---|
| Sales, payments, refunds, returns | `sales`, `payments`, `refunds`, `sale_returns` (Phase 5) | recorded again as cash movements or expenses |
| Drawer opening cash | `cashier_sessions.opening_float_minor` | an "opening cash" movement |
| Stock | the stock ledger (Phase 4) | touched by finance |
| Purchases | goods receipts (Phase 4) | expenses: they are inventory cost |

**Money.** Amounts are integer **minor units** of their record's currency, as strings ("1250" is 12.50 in a two-decimal currency, 1250 in a zero-decimal one). Currencies are three-letter codes (`^[A-Z]{3}$`). The system never converts between currencies or between major and minor units, so it needs no table of currency exponents. Clients format amounts for display. Totals are always grouped by currency. No exchange rates exist.

**Dates.** Expense `occurredOn` is a calendar date (no time zone) and must not be in the future (one day of slack) or before 2000-01-01. Report periods are inclusive UTC calendar days. Organizations have no time zone setting yet.

## 13.2 Expenses

| Route | Permission | Notes |
|---|---|---|
| `GET /expense-categories` | any finance permission | Active and archived categories |
| `POST /expense-categories` `{name, description?}` · `PATCH …/:expenseCategoryId` `{version, name?, description?, status?}` | `finance.category.manage` | Names unique per organization after trimming, collapsing spaces and lower-casing (`category_name_taken`). Archived categories take no new expenses (`category_archived`) |
| `POST /expenses` `{categoryId, amountMinor, currency?, description, reference?, occurredOn, branchId?, correctsExpenseId?}` + `Idempotency-Key` | `finance.expense.create` at `branchId` (organization-wide without one) | Creates a DRAFT `E-000001`. Currency defaults to the organization's. References containing 13–19 consecutive digits are refused (`card_data_refused`) |
| `GET /expenses?status&branchId&categoryId&from&to&createdBy=me&cursor&limit` · `GET /expenses/:expenseId` | see visibility | Keyset pagination (createdAt, id). The detail view includes events, attachment metadata and corrections |
| `PATCH /expenses/:expenseId` `{version, …}` | the creator, `finance.expense.create` at the old and new branch | DRAFT only |
| `POST …/submit` `{version}` | the creator | DRAFT → SUBMITTED |
| `POST …/approve` `{version}` · `POST …/reject` `{version, reason}` | `finance.expense.approve`, **not the creator** | SUBMITTED → APPROVED / REJECTED (reason 3–500 characters) |
| `POST …/cancel` `{version, reason?}` | the creator (with create permission) or an approver | DRAFT/SUBMITTED → CANCELLED |
| `POST …/void` `{version, reason}` | `finance.expense.void`, **not the creator** | APPROVED → VOIDED |
| `POST …/attachments` (raw body, `Content-Type`, `X-File-Name`) · `GET /expense-attachments/:expenseAttachmentId/content` | upload: the creator while DRAFT/SUBMITTED; download: anyone who can see the expense | See §13.5 |

**Lifecycle.**

```
DRAFT ─submit→ SUBMITTED ─approve→ APPROVED ─void→ VOIDED
  │                │ reject→ REJECTED
  └─cancel─────────┴ cancel→ CANCELLED
```

REJECTED, CANCELLED and VOIDED are terminal.

**Invariants.** Each is enforced by the service and by the database.

- **Legal transitions only.** `app_expense_transition_ok` in the `expenses_guard` trigger rejects any other transition.
- **What was submitted is what is decided and reported.** Amount, currency, category, branch, description, reference and date can change only while DRAFT. A non-draft row changes only by a transition, and recorded submissions and decisions never change.
- **Separation of duties.** Nobody approves, rejects or voids an expense they created. This applies to the Owner too: `expenses_no_self_decision` and `expenses_no_self_void` CHECKs back the service's 403. There is no self-approval permission. An organization therefore needs two members to approve expenses.
- **Status and fields always match.** For example, REJECTED ⇔ a rejection reason, VOIDED ⇔ who, when and why, and APPROVED/REJECTED/VOIDED ⇔ a decision.
- **Concurrency.** Every change locks the row and checks the version. Of concurrent decisions on one version, exactly one succeeds and the others get `409 version_conflict` or `409 invalid_status`. The version is server-managed (incremented by the trigger).
- **Repeats are safe.** Creation replays per `Idempotency-Key`, and a key reused with a different body gets `409 idempotency_key_reused`. A repeated transition fails deterministically (`invalid_status`) without a second effect.
- **Corrections are explicit.** An approved expense is never edited. It is voided, with a reason, and kept with its full history, and a new expense with `correctsExpenseId` replaces it and goes through approval again. A correction must name a VOIDED expense (`not_voided`), and a voided expense has at most one live correction (`already_corrected`; partial unique index `expenses_one_live_correction`).
- **Append-only history.** `expense_events` and `expense_attachments` cannot be updated or deleted (trigger, and no grant), and expenses are never deleted.

**Visibility.** A caller sees:
- expenses they created;
- expenses at branches where they hold `finance.expense.read`;
- all expenses, if they hold an approval or void permission.

Organization-level expenses (no branch) need organization-wide read.

**Approval policy.** There is one level of approval, with no amount thresholds and no multi-step workflow. These are future work.

## 13.3 Cash movements

| Route | Permission | Notes |
|---|---|---|
| `POST /branches/:branchId/cash-movements` `{type, amountMinor, reason, reference?, sessionId?, currency?}` + `Idempotency-Key` | `finance.cash.record` at the branch | `C-000001`; see types below |
| `GET /cash-movements?branchId&sessionId&type&from&to&cursor&limit` · `GET /cash-movements/:cashMovementId` | `finance.cash.read` or `finance.cash.record` at the branch | Keyset pagination |
| `POST /cash-movements/:cashMovementId/reverse` `{reason}` + `Idempotency-Key` | `finance.cash.reverse` (RESTRICTED) at the branch | See reversals |

**Types:**
- `PAID_IN` (in): petty-cash funding or a float top-up.
- `PAID_OUT` (out): an operational payout.
- `CASH_DROP` (out, session only): cash moved from a drawer to the safe.
- `BANK_DEPOSIT` (out): cash taken to the bank.
- `BANK_WITHDRAWAL` (in): cash brought from the bank.
- `REVERSAL`: created only by the reverse route.

A CHECK ties each type to its direction.

**Rules.**

- **Never sales or refunds.** Sales and refunds are never cash movements. Sale receipts are payments, and money returned is refunds; both stay in their Phase 5 records, so nothing is counted twice.
- **Session-linked movements.** A movement with `sessionId` goes into that cashier session's drawer and counts towards its **expected cash** (`src/sales/session-cash.ts`, the single definition used at close):
  - expected = float + confirmed cash payments − cash refunds + movements in − movements out;
  - the session must be OPEN at that branch (`session_closed`), and the caller must be its cashier or hold `sales.session.supervise` there;
  - the session fixes the currency (`currency_mismatch`);
  - cash taken out may not exceed what the drawer should hold (`insufficient_drawer_cash`);
  - the session row is locked `FOR UPDATE`, so concurrent movements and closing serialize: of two payouts that each fit but together do not, exactly one is accepted;
  - a database trigger re-checks that the session is open, at the same branch and in the same currency.
- **Branch-level movements.** Movements without a session are branch-level operational records. They don't affect any drawer.
- **Postings.** Postings are append-only and idempotent per `Idempotency-Key`.
- **Reversals.** A reversal is a new `REVERSAL` movement that mirrors the original exactly, in the opposite direction:
  - it has the same branch, session, currency and amount (checked by a trigger), and its reference is the original's number;
  - each movement can be reversed at most once (unique `reverses_id`; `already_reversed`), and a reversal cannot itself be reversed;
  - the original is never changed;
  - a movement in a closed session cannot be reversed, because that session's count is final. Record a new branch-level movement instead.
- **Recorded, not verified.** Every movement has `verification: "RECORDED"`. Deposits and withdrawals are what staff report; nothing is verified with a bank. **This is not bank reconciliation.**

## 13.4 Summaries and exports

All report routes require `finance.report.read` (organization-wide, RESTRICTED). Exports require `finance.report.export`.

| Route | Content |
|---|---|
| `GET /finance/summary?from&to&branchId` | Per currency: expenses, sales, payments, refunds, cash; returns (currency-free); `definitions`; `limitations` |
| `GET /finance/expense-summary?from&to&branchId&groupBy=category\|status\|branch\|month` | Per group and currency: approved, pending, by status |
| `GET /finance/cash-session-summary?from&to&branchId` | Closed sessions per currency (expected, declared, variance, short/over counts); sessions still open |
| `GET /finance/exports/expenses?from&to&branchId` · `GET /finance/exports/cash-movements?…` | CSV (rate limit `finance.export.user`, 20/h) |

`from` and `to` are required (`YYYY-MM-DD`, real dates, `to` ≥ `from`, at most 366 days: `invalid_date`, `invalid_period`, `period_too_long`). An unknown `branchId` gets 404. Every figure is a PostgreSQL aggregate under the caller's RLS context. No unbounded history is loaded.

**Metric definitions.** The summary response carries these verbatim.

| Metric | Definition |
|---|---|
| period | Inclusive UTC days [from, to]. Timestamps: [from 00:00Z, to+1 00:00Z). Expense dates: from ≤ occurredOn ≤ to |
| `expenses.approved` | APPROVED expenses with occurredOn in the period. VOIDED, REJECTED, CANCELLED, SUBMITTED and DRAFT are excluded |
| `expenses.pending` | SUBMITTED expenses with occurredOn in the period |
| `expenses.byStatus` | Count and amount per status (informational) |
| `sales.gross` | Σ `total_minor` of COMPLETED sales created in the period: server-priced line totals. The schema has no discounts or taxes, so none are deducted or added. **Not net revenue.** VOIDED sales are excluded and reported as `sales.voided` |
| `payments.confirmed` | CONFIRMED payments by confirmation time, by method. Staff attestation, not verified with any bank or processor |
| `payments.pending` / `failed` | PENDING and FAILED payments recorded in the period (not money received) |
| `refunds` | Refunds created in the period, in the refunded sale's currency, by method. A refund may concern an earlier period's sale |
| `returns` | Returns accepted in the period, by status. Returns carry no money of their own |
| `cash.in` / `cash.out` / `netMinor` | Cash movements recorded in the period, reversals included in their own direction (a reversed movement nets to zero) |
| `derived.paymentsLessRefundsMinor` | `payments.confirmed − refunds` for the period: money collected net of money returned. **Not revenue, not profit** |

**Not produced:** net revenue, profit, tax, cost of goods sold, cash-on-hand balances. The data does not support them accurately.

**Exports.**
- **Format:** RFC 4180 CSV with `Content-Disposition: attachment`, `Cache-Control: private, no-store`, and `X-Row-Count`.
- **Formula protection:** cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'`, so opening an export in a spreadsheet runs nothing.
- **Size limit:** an export of more than 10,000 rows is **refused** (`422 export_too_large`), not truncated.
- **Audit:** each export is audited (`finance.export.generated` with kind, period, branch and row count).

## 13.5 Attachments

Expense attachments use the same private storage abstraction as support (`AttachmentStorage`):
- **Storage:** bytes stay out of PostgreSQL, under server-generated keys `finance/<expense>/<attachment>`. No public or permanent URLs exist, and storage keys never appear in responses.
- **Upload:** raw body, at most 10 MB. The type is detected from the content and must be PNG, JPEG, GIF, WebP, PDF or UTF-8 text (wrong type 415, empty 400). File names are sanitized.
- **Limits:** at most 10 attachments per expense, and only while the expense is DRAFT or SUBMITTED. A database trigger checks the status as well.
- **Authorization:** the expense is checked before any bytes are examined or stored. Downloads go through an authorized request, are audited, and are sent with `nosniff`, a sandboxing CSP and `no-store`.
- **No scanning:** there is no malware scanning and no EXIF removal.
- **Production blocker:** only the local-disk development driver exists, so production mode is refused until private object storage with short-lived authorized downloads is added (config `productionBlockers`).

Uploads are rate-limited (`finance.upload.user`, 60/h).

## 13.6 Permissions

The existing `finance.*` keys are reused. Phase 6 adds the following, with role template **version 4** (`src/authz/role-template-history.ts`) applied to existing organizations by `pnpm api db:seed` under the §10.6.1 rules: additive, exclusions respected, custom roles untouched.

| Key | Scope, sensitivity | Default roles |
|---|---|---|
| `finance.expense.read` | BRANCH | org admin, branch manager, accountant, auditor |
| `finance.expense.create` (existing) | BRANCH | org admin, branch manager, accountant |
| `finance.expense.approve` (existing) | ORGANIZATION, RESTRICTED | org admin, accountant |
| `finance.expense.void` | ORGANIZATION, RESTRICTED | org admin, accountant |
| `finance.category.manage` | ORGANIZATION | org admin, accountant |
| `finance.cash.read` | BRANCH | org admin, branch manager, accountant, auditor |
| `finance.cash.record` | BRANCH | org admin, branch manager |
| `finance.cash.reverse` | BRANCH, RESTRICTED | org admin, accountant |
| `finance.report.read` (existing) | ORGANIZATION, RESTRICTED | org admin, accountant, auditor |
| `finance.report.export` | ORGANIZATION, RESTRICTED | org admin, accountant |
| `finance.ledger.reconcile` (existing) | ORGANIZATION, RESTRICTED | reserved: no ledger or bank reconciliation exists |

**Cashiers, sales representatives, storekeepers and viewers get no finance permission.** A branch manager records drawer movements for cashiers' sessions (it holds `sales.session.supervise`).

## 13.7 Database

- **Tables.** `expense_categories`, `expenses`, `expense_events`, `expense_attachments`, `cash_movements`:
  - all under forced, membership-bound tenant RLS;
  - composite `(id, organization_id)` foreign keys, plus a direct foreign key to `organizations` where the branch is optional.
- **Grants.** The runtime role has SELECT/INSERT/UPDATE on categories and expenses, and only SELECT/INSERT on events, attachments and cash movements. It has no DELETE anywhere.
- **Constraints and triggers.** CHECKs cover amounts (1 to 10^15), currency format, number formats, reasons, references (no card numbers), idempotency keys, status-field consistency and self-decisions. Triggers enforce transitions, immutability, attachment status, cash-session state and reversal mirroring, plus append-only enforcement.
- **Protected index.** The partial unique index `expenses_one_live_correction` is listed in the migration guard.
- **Migration safety.** The migration only creates objects (no existing row is touched), so it takes no long locks. Its rollback is a forward migration, as everywhere in this repository.

## 13.8 Limitations and future phases

- **Accounting.** No general ledger or double-entry, journals, tax, payroll, budgets or forecasting.
- **Banking and payments.** No bank integrations, bank reconciliation, payment gateways or exchange rates.
- **Approvals.** One approval level, without thresholds. A single-member organization cannot approve its own expenses.
- **Notifications.** No email notifications for approval decisions. The email outbox exists, but templates and preferences for finance events are future work.
- **Payout tracking.** Expenses are not linked to the cash movement or payment that paid them.
- **Production storage.** Attachments need production object storage (§13.5).
