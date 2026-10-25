# 12. Sales, point of sale, payments and returns (Phase 5)

Code: `src/sales/`. Migration `20261027090000_sales_pos`. Tests: `test/sales.e2e-spec.ts`, `src/sales/customers.spec.ts`, plus the route-generated authorization sweeps (`test/authorization-matrix.e2e-spec.ts`), which now seed and fingerprint every sales table.

All routes are under `/v1/orgs/:orgId` and follow [10-organizations.md §10.1](10-organizations.md) and [11-inventory-purchasing.md](11-inventory-purchasing.md):
- membership plus permission;
- 404 for records the caller cannot see; 403 when they can see a record but may not act on it;
- unknown body fields rejected (so clients cannot send prices, totals or card data);
- `version` for optimistic concurrency, and audit events in the same transaction.

Money is integer minor units as strings; quantities are decimal strings limited by the product's unit precision. No floating point anywhere.

## 12.1 Customers

| Route | Permission | Notes |
|---|---|---|
| `GET /customers?q&status&branchId&cursor&limit` | `sales.customer.read` | `q` matches name, email or phone; `%` and `_` match literally. Sorted by name, keyset cursor |
| `GET /customers/:customerId` | `sales.customer.read` | |
| `POST /customers` `{name, email?, phone?, notes?, homeBranchId?}` | `sales.customer.manage` | Email is lower-cased; phone is reduced to digits with an optional `+` (6–15 digits). Both are unique per organization (409 `customer_email_taken` / `customer_phone_taken`, also under concurrency: unique indexes decide) |
| `PATCH /customers/:customerId` `{version, …, status?: ACTIVE\|INACTIVE}` | `sales.customer.manage` | Row lock plus version check; deactivate and reactivate are audited as such. Customers are never deleted (sales reference them) |

- **Minimal personal data:** a name and optional contact details and notes (≤ 1000 characters). The audit log records which fields were provided or changed, never their values.
- **Branch-aware visibility:** `sales.customer.read` is an organization permission that can be attached to branch assignments. An organization-wide grant sees every customer. A branch-limited grant sees only the customers whose home branch is one of those branches.
- Inactive customers cannot be put on new sales (`customer_inactive`).

## 12.2 Cashier sessions

| Route | Permission | Notes |
|---|---|---|
| `POST /branches/:branchId/cashier-sessions` `{openingFloatMinor}` | `sales.session.manage` at the branch | Branch must be ACTIVE. One OPEN session per cashier and branch: a partial unique index (`cashier_sessions_one_open`, protected by the migration guard) makes concurrent opens yield one 201 and `409 session_already_open` |
| `GET /branches/:branchId/cashier-sessions?status` | own sessions with `sales.session.manage`; everyone's with `sales.session.supervise` | |
| `GET /cashier-sessions/:sessionId` | as above | Includes `expectedCashSoFarMinor` |
| `POST /cashier-sessions/:sessionId/close` `{version, declaredCashMinor, note?}` | the cashier, or `sales.session.supervise` | Locks the session. **Expected cash** = opening float + CONFIRMED CASH payments in the session − CASH refunds paid out of the session. Stores expected, declared and `variance = declared − expected` (a CHECK constraint enforces the arithmetic). Closing is final (`session_closed`; a trigger refuses any later change). Closing is allowed at an archived branch |

Sales and cash movements need the caller's **own** open session at that branch (`no_open_session`). Card, transfer and mobile-money payments are linked to no session and do not count towards the drawer.

## 12.3 Sales

| Route | Permission | Notes |
|---|---|---|
| `POST /branches/:branchId/sales` `{lines:[{productId, quantity}], customerId?, relatedReturnId?}` + `Idempotency-Key` | `sales.sale.create` at the branch | See below |
| `GET /sales?branchId&status&customerId&sessionId&cursor&limit` | `sales.sale.read` (branches where held) | 403 without the permission anywhere; branch-limited holders see only their branches |
| `GET /sales/:saleId` | `sales.sale.read` at the sale's branch | Lines (with `movementId`), payments, refunds, returns, and computed amounts: confirmed, pending, refunded, outstanding, `paymentStatus` (`UNPAID`/`PARTIALLY_PAID`/`PAID`), `refundStatus` |
| `POST /sales/:saleId/void` `{version, reason}` | `sales.sale.void` (RESTRICTED) at the branch | See §12.6 |
| `GET /sales/report?from&to&branchId` | `sales.report.read` | Totals by status, payment method and status, and refunds |

**Posting a sale is one transaction:**
1. **Checks.** The branch must be ACTIVE, and the caller must have an open session there. The customer, if any, must be visible and active. Products must be ACTIVE, have a selling price (`no_selling_price`) and be priced in the session's currency. Quantities must fit the unit precision (`invalid_quantity_precision`), and each product appears once.
2. **Prices and totals.** The server takes each product's current selling price, computes `line total = round(quantity × price)` half-up, and sums the sale total. Clients cannot send prices.
3. **Receipt number.** `R-000001`, … is allocated from the per-organization counter (`organization_sequences`, row-locked upsert), so it is unique under concurrency. Gaps are possible when a sale rolls back.
4. **Stock out.** The sale row is inserted, then one **`SALE` movement** per line goes through the Phase 4 ledger (`postMovements`):
   - the trigger locks the balance and refuses negative stock (`insufficient_stock`) and archived branches;
   - movements are posted in a fixed order, so concurrent multi-line sales cannot deadlock;
   - each movement's idempotency key is `sale:<saleId>:<productId>`, with source `SALE`/`saleId`.
5. **Lines.** Lines are written with their `movement_id`. The database checks each line:
   - it can be added only by the transaction that inserted the sale (trigger `app_sale_line_guard`, comparing the sale row's `xmin` with the current transaction);
   - its movement must be a `SALE` movement for the same branch, product and sale, with `delta = −quantity`.
6. **Total check.** At commit, a deferred constraint trigger verifies that the sale total equals the sum of the lines and that there is at least one line.

Any failure rolls back everything: there is no sale, no line, no movement and no stock change, so a sale can never be "completed" without its posting. No stock is reserved; stock leaves only when the sale posts.

**Idempotency** is database-backed (unique `(organization_id, idempotency_key)` on sales, and on each movement key):
- a retry returns the original sale with `replayed: true`;
- concurrent duplicates post once: the loser hits the unique index and replays;
- the same key with a different request gets 409 `idempotency_key_reused`;
- the key is required (400).

**Immutability:**
- sales cannot be deleted;
- the only permitted change is COMPLETED → VOIDED, with void fields, and voided is final;
- lines are immutable except that `quantity_returned` may grow, up to the quantity.

## 12.4 Payments

| Route | Permission | Notes |
|---|---|---|
| `POST /sales/:saleId/payments` `{method, amountMinor, reference?}` + `Idempotency-Key` | `sales.payment.confirm` at the branch | Methods: `CASH`, `CARD_EXTERNAL`, `BANK_TRANSFER`, `MOBILE_MONEY`, `OTHER` |
| `POST /payments/:paymentId/confirm` `{version}` | `sales.payment.confirm` | PENDING → CONFIRMED (staff attestation) |
| `POST /payments/:paymentId/fail` `{version, reason}` | `sales.payment.confirm` | PENDING → FAILED; frees the amount |

- **Recording is separate from the sale.** A sale can be unpaid, partly paid or paid by several methods.
- **Limits.** Payments are recorded under the sale row lock. The sum of non-FAILED payments never exceeds the total (`overpayment`), also when payments race.
- **CASH** is CONFIRMED on receipt and goes into the recorder's open session at the sale's branch (a CHECK requires a session for cash). Other methods start **PENDING** until confirmed or failed.
- **Statuses and transitions.** Statuses are `PENDING`, `CONFIRMED` and `FAILED`. "Refunded" is tracked by `refunded_minor` on a CONFIRMED payment and shown as the sale's `refundStatus`. A trigger allows only PENDING → CONFIRMED|FAILED, keeps the amount, method, sale and reference immutable, and lets `refunded_minor` only grow.
- **Not bank-verified.** There is no gateway integration. Every payment carries `verification: "MANUAL"`, a CHECK constraint allows nothing else, and the report says so. A confirmation records who attested it, not that a bank or processor verified it.
- **No card data.**
  - The API has no card, CVV or credential fields; unknown fields get 400.
  - `reference` is meant for a terminal slip or transfer reference. A reference containing 13–19 consecutive digits is refused (`card_data_refused`), and a database CHECK refuses such references as well.
  - No secrets are stored.
- **Idempotency** works as for sales. The replay is re-checked after the row lock, so a concurrent duplicate replays instead of failing the amount check.

## 12.5 Refunds

`POST /payments/:paymentId/refunds` `{amountMinor, reason, returnId?}` + `Idempotency-Key` requires `sales.sale.refund` at the branch. Cashiers do not hold it by default; branch managers do.
- **Eligibility.** Only CONFIRMED payments can be refunded (`payment_not_confirmed`).
- **Partial and full refunds.** Refunds are processed under the payment row lock, and cumulative refunds never exceed the payment (`refund_exceeds_payment`). A CHECK constraint `refunded_minor ≤ amount_minor` backs this; it is also enforced under concurrency.
- **Cash refunds** come out of the refunder's own open session at the branch.
- **Linking a return.** `returnId` optionally links the refund to a return of the same sale; another sale's return gives 404.
- **Records.** Refunds are append-only, and each records the reason and the actor. They are audited (`sales.payment.refunded`) with the reason.
- **A refund never restocks.** Goods come back only through a return and an explicit restock (§12.7).

## 12.6 Voids

A void reverses a sale that should not have happened. It requires `sales.sale.void`, the current `version` and a reason. It is refused in these cases:
- the sale is already voided (`sale_voided`);
- any goods were returned (`sale_has_returns`), because a return is the correct path then;
- any payment is PENDING or CONFIRMED and not fully refunded (`payments_outstanding`).

A void posts `SALE_VOID` movements (+quantity, source `SALE_VOID`/`saleId`, one per line, idempotent), marks the sale VOIDED with actor, time and reason, and is audited. The void is the explicit, authorized action that restores the stock. History is kept: the original lines, SALE movements and payments remain.

## 12.7 Returns and exchanges

| Route | Permission | Notes |
|---|---|---|
| `POST /sales/:saleId/returns` `{reason, lines:[{saleLineId, quantity, disposition}]}` + `Idempotency-Key` | `sales.return.accept` at the branch | Dispositions: `RESALEABLE`, `DAMAGED`, `UNSELLABLE` |
| `POST /returns/:returnId/restock` | `sales.return.restock` at the branch | |

- **Accepting** a return locks the sale. Each line must belong to that sale, and its quantity must be ≤ `quantity − quantity_returned` (`exceeds_returnable`). Because of the lock, concurrent returns cannot over-return. Acceptance increments `quantity_returned` and records the reason and dispositions. **No stock moves at acceptance.** Voided sales cannot be returned against.
- **Restocking** posts a `SALE_RETURN` movement (+quantity, source `SALE_RETURN`/`returnId`, key `sale-return:<returnId>:<saleLineId>`) for **RESALEABLE lines only**.
  - DAMAGED and UNSELLABLE goods are never restocked; a return with nothing resaleable gets `nothing_to_restock`.
  - Restocking is a separate permission, under a row lock, and happens once per return (`already_restocked`; the status trigger allows ACCEPTED → RESTOCKED once).
  - The branch must be active.
- **Refund outcome.** Money goes back through §12.5, optionally linked by `returnId`. A return without a refund (for example store credit handled outside the system, or an exchange) is allowed.
- **Exchanges** are a return of the old goods plus a **new sale** with `relatedReturnId`. Posted history is never mutated: the original sale keeps its lines, total and version.
- Return lines and refunds are append-only.

## 12.8 Permissions

The existing `sales.*` keys are reused. Phase 5 adds only these narrow keys:

| Key | Scope | Default roles |
|---|---|---|
| `sales.sale.void` | BRANCH, RESTRICTED | org admin, branch manager |
| `sales.session.manage` | BRANCH | org admin, branch manager, cashier, sales rep |
| `sales.session.supervise` | BRANCH | org admin, branch manager |
| `sales.return.accept` | BRANCH | org admin, branch manager, cashier |
| `sales.return.restock` | BRANCH | org admin, branch manager |
| `sales.report.read` | ORGANIZATION, RESTRICTED | org admin, accountant, auditor |

`sales.payment.confirm` covers recording and confirming payments; `sales.sale.refund` covers refunds. Suspended memberships, inactive users, archived branches and revoked permissions (DENY overrides) are refused like everywhere else; each case is tested. The full matrix is in [rbac-matrix.md](rbac-matrix.md).

## 12.9 Database

- **Tables** (all under forced tenant RLS, with composite `(id, organization_id)` foreign keys): `customers`, `cashier_sessions`, `sales`, `sale_lines`, `payments`, `refunds`, `sale_returns`, `sale_return_lines`.
- **Grants.** The runtime role has SELECT/INSERT/UPDATE, and only SELECT/INSERT on `refunds` and `sale_return_lines`; it has no DELETE anywhere.
- **Ledger.** The stock ledger gains the movement types `SALE`, `SALE_RETURN` and `SALE_VOID`; a CHECK ties each to its sign and source type. The runtime role still cannot write `stock_balances`, and all stock changes still go through `app_stock_post_movement`.
- **Constraints.**
  - Money is `bigint` minor units and quantities are `numeric(18,3)`.
  - CHECKs cover amounts, currencies, line arithmetic, returned ≤ sold, refunded ≤ amount (and only on CONFIRMED payments), session close consistency and variance, cash ⇒ session, manual verification only, reference length and no card numbers, and reason lengths.
