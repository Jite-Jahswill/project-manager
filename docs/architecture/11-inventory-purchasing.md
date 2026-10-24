# 11. Inventory, stock ledger, suppliers and purchasing (Phase 4)

Code: `src/inventory/` (catalogue, ledger, stock operations) and `src/purchasing/` (suppliers, purchase orders). Migration `20261026090000_inventory_purchasing`. Tests: `test/inventory.e2e-spec.ts`, `test/purchasing.e2e-spec.ts`, `test/stock.e2e-spec.ts`, `src/inventory/quantity.spec.ts`, plus the route-generated authorization sweeps.

All routes are under `/v1/orgs/:orgId` and follow [10-organizations.md §10.1](10-organizations.md): membership plus permission, 404 for other organizations' IDs, unknown body fields rejected, `version` for optimistic concurrency, and audit events in the same transaction. Lists return `{ items, nextCursor }` (opaque keyset cursors).

## 11.1 Values

- **Quantities** are decimal strings with at most 3 decimals, never floating point. Each product's unit fixes its precision: `each`, `piece`, `pair`, `dozen`, `pack`, `box`, `carton`, `bag`, `bottle`, `roll`, `g`, `ml` and `cm` take whole numbers; `kg`, `tonne`, `l`, `m`, `m2` and `m3` take up to 3 decimals. The API and the database both enforce it (`invalid_quantity_precision`). A product's unit cannot change once it has stock history or order lines (`unit_locked`).
- **Money** is integer **minor units** as a string (`"1250"`), in the product's or order's currency, up to 10^15.
- **Line totals** are `round(quantity × unit cost)`, rounded half-up. They are computed by the server and checked by a database constraint. Order subtotals are maintained by the database from the lines. Clients never send totals: an unknown field gets 400.
- **Cost prices** (product cost, supplier default cost, order costs, movement unit cost) need `inventory.cost.read`, both to view them and to set them. Order costs are also visible to whoever creates, submits or approves orders at that branch.

## 11.2 Catalogue

| Route | Permission | Notes |
|---|---|---|
| `GET /product-categories?status` · `POST` · `PATCH /:categoryId` `{version,…}` · `POST /:categoryId/archive` `{version}` | read: `inventory.product.read`; write: `inventory.category.manage` | Unique by case- and space-insensitive name (409 `category_name_taken`). One level of nesting. Archived categories keep their products but cannot be assigned. A category with active children cannot be archived |
| `GET /products?q&status&categoryId&cursor&limit` | `inventory.product.read` | `q` matches name, SKU or barcode as a case-insensitive substring. **`%`, `_` and `\` match literally**: they are escaped, and the value is always a bound parameter (fixes the Phase 3 note). `status` defaults to `ACTIVE`. Sorted by name |
| `GET /products/:productId` | `inventory.product.read` | |
| `POST /products` `{sku, name, unit?, description?, categoryId?, barcode?, costPriceMinor?, sellingPriceMinor?, reorderLevel?}` | `inventory.product.create` | SKU and barcode are unique per organization (409 `sku_taken` / `barcode_taken`, also under concurrency). Currency is the organization default. Plan product limit applies |
| `PATCH /products/:productId` `{version, …, status?: ACTIVE\|INACTIVE}` | `inventory.product.update` | `INACTIVE` products stay in the catalogue and can be counted, adjusted or transferred, but cannot be ordered or given opening balances |
| `POST /products/:productId/archive` | `inventory.product.archive` | Refused while stock is on hand at any branch (`stock_on_hand`) or the product is on an open order (`open_purchase_orders`). Archived products cannot be edited or moved |

Variants are not modeled: each sellable variant is its own product (SKU/barcode). Alternate identifiers are the barcode and per-supplier SKUs (§11.4).

## 11.3 Stock ledger

**Balances change only through `stock_movements` rows, and the database does the posting.** The runtime database role holds SELECT only on `stock_balances`. A `BEFORE INSERT` trigger (`app_stock_post_movement`, SECURITY DEFINER owned by `ventidoc_rls`):
- checks that the branch is ACTIVE and that the quantity fits the product's unit precision;
- locks the balance row, creating it at zero on first use;
- computes the new quantity and refuses a negative result (`insufficient_stock`);
- updates the balance;
- fills in `balance_after`, and stamps `created_at` **under the lock**, so ledger order is posting order.

For counts it derives the delta from the counted quantity against the *locked* balance. Any failure aborts the whole statement, balance update included. Movements are append-only for every role.

**Negative stock policy:** never allowed. Every movement type, receipts and returns included, is refused if it would take a balance below zero.

**Duplicate posting:** `(organization_id, idempotency_key)` is unique on movements and on every operation header (counts, transfers, receipts, returns). A retry with the same key returns the original result (`replayed: true`); the same key with a different payload gets 409 `idempotency_key_reused`. Once-only operations derive their key from what they are: `opening:<branch>:<product>` and `reversal:<movement>`. Concurrent duplicates therefore post once.

**Deadlock avoidance:** multi-line operations post in a fixed (branch, product) order.

| Route (branch-scoped: `/branches/:branchId/…`) | Permission at that branch | Notes |
|---|---|---|
| `GET stock?q&cursor&limit` | `inventory.stock.read` | Balances with `reorderLevel` and a `low` flag |
| `GET stock/movements?productId&type&cursor&limit` | `inventory.stock.read` | Newest first; `sourceType`/`sourceId` link receipts, transfers, counts and returns |
| `GET stock/low` | `inventory.stock.read` | Products at or below `reorderLevel` (no balance counts as 0) |
| `GET stock/reconciliation` | `inventory.stock.read` | For each balance: ledger sum and last `balance_after`; `consistent` plus any discrepancies |
| `POST stock/opening-balances` `{productId, quantity>0, reason, unitCostMinor?}` | `inventory.stock.adjust` | Once per product and branch, before any other movement (`opening_balance_exists` / `stock_history_exists`) |
| `POST stock/adjustments` `{productId, quantityDelta≠0, reason}` + `Idempotency-Key` | `inventory.stock.adjust` | Mandatory reason |
| `POST stock/counts` `{note, lines[{productId, countedQuantity≥0}]}` + `Idempotency-Key` | `inventory.stock.count` | Posts the differences (`COUNT`). Returns expected, counted and difference per line; matching lines post nothing |
| `GET stock/counts/:countId` | `inventory.stock.read` | |
| `POST stock/transfers` `{toBranchId, reason, lines[{productId, quantity>0}]}` + `Idempotency-Key` | `inventory.stock.transfer` at **both** branches | Out and in post in one transaction; both branches must be active; all lines or none |
| `POST stock/movements/:movementId/reverse` `{reason}` | `inventory.stock.approve_adjustment` | Correcting entry (`REVERSAL`, equal and opposite) for an adjustment, opening balance or count, once (repeat = replay). Receipts, transfers and returns are corrected through their own workflows |

Archived branches: no new movements of any kind (API and trigger); history stays readable.

## 11.4 Suppliers

| Route | Permission | Notes |
|---|---|---|
| `GET /suppliers?q&status&cursor&limit` · `GET /suppliers/:supplierId` | `purchasing.supplier.read` | |
| `POST /suppliers` `{code, name, contactName?, email?, phone?, address?, taxId?, paymentTermsDays?, currency?, notes?}` | `purchasing.supplier.manage` | Unique `code` and normalized name (case and spacing): `supplier_code_taken` / `supplier_name_taken`. Business contact data only |
| `PATCH /suppliers/:supplierId` `{version, …, status?: ACTIVE\|INACTIVE}` | `purchasing.supplier.manage` | Inactive suppliers cannot receive new orders, submissions or approvals. Suppliers are never deleted |
| `GET /suppliers/:supplierId/products` · `PUT …/products/:productId` `{supplierSku?, defaultUnitCostMinor?, leadTimeDays?}` · `DELETE …` | read / manage | Supplier SKUs and default costs (cost needs `inventory.cost.read`) |
| `GET /suppliers/:supplierId/summary` | `purchasing.report.read` | Orders by status, value received (net of returns, at order cost), open commitment, recent orders. **No "amount owed":** invoices and payments are not modeled yet |

## 11.5 Purchase orders

```
DRAFT ─submit→ SUBMITTED ─approve→ APPROVED ─issue→ ISSUED ─receive→ PARTIALLY_RECEIVED ─receive→ RECEIVED
  ↑               │ reject                              │                   │ close (short)
  └──── edit ── REJECTED            cancel: DRAFT, REJECTED, SUBMITTED, APPROVED, ISSUED (nothing received) → CANCELLED
                                     corrections can move RECEIVED/PARTIALLY_RECEIVED back while receiving
```

The database enforces valid transitions (`app_purchase_order_transition_ok`). Lines can change only in DRAFT/REJECTED; received and returned quantities only while receiving. CLOSED and CANCELLED are terminal. The `version` is server-managed.

| Route | Permission (at the order's branch) | Notes |
|---|---|---|
| `GET /purchase-orders?status&supplierId&branchId&cursor&limit` | membership; filtered to branches where you hold `purchasing.order.read` | |
| `POST /branches/:branchId/purchase-orders` `{supplierId, lines[{productId, quantity, unitCostMinor}], notes?, expectedDate?}` | `purchasing.order.create` | Active supplier, active branch, active products, one line per product. Number `PO-000001` per organization. Currency is the supplier's |
| `GET /purchase-orders/:purchaseOrderId` · `…/events` · `…/receipts` | `purchasing.order.read` | Events are append-only status history. **404 when you cannot see orders at that branch** |
| `PATCH /purchase-orders/:id` `{version, supplierId?, lines?, notes?, expectedDate?}` | `purchasing.order.create` | DRAFT or REJECTED (a rejected order returns to DRAFT). `lines` replaces all lines |
| `POST …/submit` `{version}` | `purchasing.order.submit` | At least one line |
| `POST …/approve` `{version}` | `purchasing.order.approve` | **Separation of duties:** not by the order's creator or submitter (403 `separation_of_duties`) unless you hold `purchasing.order.self_approve` (restricted); the order then records `selfApproved: true`. The database refuses approval by the submitter without that flag |
| `POST …/reject` `{version, reason}` | `purchasing.order.approve` | |
| `POST …/issue` `{version}` | `purchasing.order.create` | Confirms the approved order to the supplier; only issued orders can be received |
| `POST …/cancel` `{version, reason}` | DRAFT/REJECTED: `create`; SUBMITTED/APPROVED/ISSUED: `approve` | Only if nothing was received (`goods_received`: close instead). History kept |
| `POST …/close` `{version, reason}` | `purchasing.order.approve` | Short-closes a PARTIALLY_RECEIVED order |
| `POST …/receipts` `{lines[{lineId, quantity>0}], note?}` + `Idempotency-Key` | `purchasing.order.receive` | Stock in (`RECEIPT` movements, carrying the line's unit cost), received quantities and status in one transaction. **Cumulative receipts cannot exceed the ordered quantity** (`over_receipt`; also a database constraint). There is no over-receipt policy. Same key returns the same receipt, also when concurrent. All lines or none |
| `POST …/returns` `{type: RETURN\|RECEIPT_CORRECTION, reason, lines[{lineId, quantity>0}]}` + `Idempotency-Key` | `purchasing.return.create` | **RETURN:** goods back to the supplier (stock out; returned quantity grows; at most received − returned). **RECEIPT_CORRECTION:** a receipt recorded too much (stock out; received quantity shrinks, so the order can be received again). Both need the stock on hand |
| `GET /purchasing/reports/summary?from&to` | `purchasing.report.read` | Counts and values by status and by supplier |

Not in scope: tax, discounts, freight, supplier invoices, payments, approval limits by amount, emergency receipts without an approved order. None of these is silently bypassed: receiving requires an issued order.

## 11.6 Permissions added in Phase 4

| Key | Scope | Restricted | Templates |
|---|---|---|---|
| `inventory.stock.count` | branch | | Inventory manager, Branch manager, Storekeeper |
| `inventory.category.manage` | organization | | Inventory manager |
| `inventory.cost.read` | organization | yes | Inventory manager, Accountant, Auditor |
| `purchasing.order.read` | branch | | Inventory manager, Branch manager, Storekeeper, Accountant, Auditor |
| `purchasing.order.submit` | branch | | Inventory manager, Branch manager |
| `purchasing.order.self_approve` | branch | yes | none (owners hold everything; grant explicitly) |
| `purchasing.return.create` | branch | | Inventory manager, Branch manager |
| `purchasing.report.read` | organization | yes | Inventory manager, Accountant, Auditor |

The Organization administrator template receives all of these except `purchasing.order.self_approve`. **Existing organizations:** role templates are copied when an organization is created, so roles in organizations created before this phase do not gain the new permissions automatically. Owners hold everything, and administrators can add the permissions to their roles.

## 11.7 Database objects

New tables, each with FORCEd membership-bound RLS and composite `(id, organization_id)` foreign keys:
- `product_categories`
- `suppliers` and `supplier_products`
- `organization_sequences`
- `purchase_orders`, `purchase_order_lines` and `purchase_order_events`
- `goods_receipts` (+ lines)
- `supplier_returns` (+ lines)
- `stock_counts` (+ lines)
- `stock_transfers`

Append-only: movements, events, receipts, returns, counts, transfers. The runtime role lost DELETE on `products` and all writes on `stock_balances`.

**Migration-time data fixes:** migrations run as the tables' owner, and FORCEd RLS binds the owner, so any data fix must lift FORCE on that table for the duration of the fix (other roles stay bound). Phase 4 does this for its currency backfill. The Phase 3 migration's data fixes lacked it and silently matched no rows; on a database holding the affected rows, its constraints would have aborted it. That migration was corrected in this phase. It had only ever run on the local development and test databases, where the fixes were no-ops anyway.
