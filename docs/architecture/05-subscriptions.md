# 5. Subscription entitlements: enforcement design

## Model

- `plans` → `plan_prices` (currency, `amount_minor`, MONTH/YEAR) and `plan_entitlements` (`key`, `enabled`, `limit_value`; `NULL` = unlimited).
- `organization_subscriptions` holds one row per organization, with the plan, status and period dates.
- Entitlement keys: `limit.*` numeric caps (implemented: `limit.branches`, `limit.members`, `limit.products`) and `feature.*` toggles (to be added per module, e.g. `feature.payroll`).
- **Fail closed**: a key missing from a plan means "not included".

## Enforcement (`src/subscriptions/entitlement.service.ts`)

| Call | Behaviour |
|---|---|
| `assertBelowLimit(tx, orgId, key, count)` | Locks the organization row (`FOR UPDATE`), checks status, then compares the current count to the limit **inside the same transaction as the insert**. Tested: 8 concurrent branch creations with 4 free slots yield exactly 4 successes. |
| `assertWritable(tx, orgId)` | Used by every other write path (product edits, stock adjustments). |
| Member limit | Checked when inviting (active + pending), when **reactivating** a suspended member, and again when an invitation is **accepted** (so a downgrade holds). |
| `usage(tx, orgId)` | Plan, status and usage vs limits, for the UI. |

The organization **can't change its own subscription**: there is no endpoint. RLS allows UPDATE only in platform scope, and org-context INSERT only for a ≤ 31-day `TRIALING` subscription. Plan, price and entitlement rows are writable only in platform scope (all tested).

## Status policy

| Status | Writable | Notes |
|---|---|---|
| `TRIALING` | until `trial_ends_at` | New orgs: `starter`, 14 days |
| `ACTIVE` | yes | |
| `PAST_DUE` | yes | payment retry window; banner in UI |
| `GRACE` | until `grace_ends_at` | after retries fail |
| `RESTRICTED`, `CANCELED`, `EXPIRED` | **no**: read-only | all data readable and retained |

Data is **never deleted** on expiry. Pending policy (product decision): export remains available in read-only mode; retention of N days after cancellation, then a deletion workflow with owner notification and a final export.

## Still to build

- Billing-provider integration (webhooks → platform-scope updates, idempotent by provider event ID), coupons, add-ons, proration for upgrades/downgrades, and a scheduled job that moves expired trials and grace periods to read-only.
- Downgrades below current usage: allowed; existing records are kept, and new creations are blocked until usage is under the limit.
- Platform endpoints for plan management (`platform.plan.manage`, privileged).
- Storage-limit enforcement with file uploads.
