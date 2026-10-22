/**
 * Entitlement keys. `limit.*` entitlements are numeric caps (NULL = unlimited);
 * `feature.*` entitlements are on/off. A key missing from a plan means "not
 * included" (limit 0 / disabled): entitlements fail closed.
 */
export const ENTITLEMENTS = {
  branches: 'limit.branches',
  members: 'limit.members',
  products: 'limit.products',
} as const;

export type LimitKey = (typeof ENTITLEMENTS)[keyof typeof ENTITLEMENTS];

export interface PlanSeed {
  code: string;
  name: string;
  prices: { currency: string; amountMinor: bigint; interval: 'MONTH' | 'YEAR' }[];
  entitlements: { key: string; limitValue: number | null; enabled?: boolean }[];
}

/** Starter catalog; prices are placeholders pending product decisions (see docs). */
export const PLAN_SEEDS: readonly PlanSeed[] = [
  {
    code: 'starter',
    name: 'Starter',
    prices: [{ currency: 'USD', amountMinor: 0n, interval: 'MONTH' }],
    entitlements: [
      { key: ENTITLEMENTS.branches, limitValue: 1 },
      { key: ENTITLEMENTS.members, limitValue: 5 },
      { key: ENTITLEMENTS.products, limitValue: 200 },
    ],
  },
  {
    code: 'growth',
    name: 'Growth',
    prices: [
      { currency: 'USD', amountMinor: 4_900n, interval: 'MONTH' },
      { currency: 'USD', amountMinor: 49_000n, interval: 'YEAR' },
    ],
    entitlements: [
      { key: ENTITLEMENTS.branches, limitValue: 5 },
      { key: ENTITLEMENTS.members, limitValue: 25 },
      { key: ENTITLEMENTS.products, limitValue: 5_000 },
    ],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    prices: [{ currency: 'USD', amountMinor: 29_900n, interval: 'MONTH' }],
    entitlements: [
      { key: ENTITLEMENTS.branches, limitValue: null },
      { key: ENTITLEMENTS.members, limitValue: null },
      { key: ENTITLEMENTS.products, limitValue: null },
    ],
  },
];

export const DEFAULT_PLAN_CODE = 'starter';
export const TRIAL_DAYS = 14;
