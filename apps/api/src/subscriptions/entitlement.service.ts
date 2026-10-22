import { Injectable } from '@nestjs/common';
import type { OrganizationSubscription } from '../generated/prisma/client';
import { Errors } from '../common/errors';
import type { Tx } from '../database/tenant-db.service';
import { ENTITLEMENTS, LimitKey } from './entitlements';

/**
 * Server-side subscription enforcement. Call inside the same tenant transaction
 * as the write being guarded.
 *
 * Limits are checked after locking the organization row (SELECT ... FOR UPDATE),
 * which serializes concurrent creations within one organization, so two parallel
 * requests cannot both take the last free slot.
 */
@Injectable()
export class EntitlementService {
  /** Inactive subscriptions leave the organization readable but not writable; data is preserved. */
  async assertWritable(tx: Tx, orgId: string): Promise<void> {
    const sub = await tx.organizationSubscription.findUnique({ where: { organizationId: orgId } });
    if (!sub || !isWritable(sub, new Date())) throw Errors.subscriptionReadOnly();
  }

  async assertBelowLimit(tx: Tx, orgId: string, key: LimitKey, countCurrent: () => Promise<number>): Promise<void> {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${orgId}::uuid FOR UPDATE`;
    const sub = await tx.organizationSubscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: { include: { entitlements: { where: { key } } } } },
    });
    if (!sub || !isWritable(sub, new Date())) throw Errors.subscriptionReadOnly();
    const entitlement = sub.plan.entitlements[0];
    if (!entitlement || !entitlement.enabled) throw Errors.entitlementLimit(key);
    if (entitlement.limitValue === null) return;
    if ((await countCurrent()) >= entitlement.limitValue) throw Errors.entitlementLimit(key);
  }

  async usage(tx: Tx, orgId: string) {
    const sub = await tx.organizationSubscription.findUnique({
      where: { organizationId: orgId },
      include: { plan: { include: { entitlements: true } } },
    });
    if (!sub) return null;
    const [branches, members, products] = await Promise.all([
      tx.branch.count({ where: { status: 'ACTIVE' } }),
      tx.organizationMembership.count({ where: { organizationId: orgId, status: 'ACTIVE' } }),
      tx.product.count({ where: { status: 'ACTIVE' } }),
    ]);
    const limit = (key: string) => sub.plan.entitlements.find((e) => e.key === key)?.limitValue ?? 0;
    return {
      plan: { code: sub.plan.code, name: sub.plan.name },
      status: sub.status,
      writable: isWritable(sub, new Date()),
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      usage: {
        [ENTITLEMENTS.branches]: { used: branches, limit: limit(ENTITLEMENTS.branches) },
        [ENTITLEMENTS.members]: { used: members, limit: limit(ENTITLEMENTS.members) },
        [ENTITLEMENTS.products]: { used: products, limit: limit(ENTITLEMENTS.products) },
      },
    };
  }
}

export function isWritable(sub: Pick<OrganizationSubscription, 'status' | 'trialEndsAt' | 'graceEndsAt'>, now: Date): boolean {
  switch (sub.status) {
    case 'ACTIVE':
    case 'PAST_DUE':
      return true;
    case 'TRIALING':
      return !sub.trialEndsAt || sub.trialEndsAt > now;
    case 'GRACE':
      return !!sub.graceEndsAt && sub.graceEndsAt > now;
    default:
      return false;
  }
}
