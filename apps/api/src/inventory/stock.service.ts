import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import { EntitlementService } from '../subscriptions/entitlement.service';
import type { StockAdjustmentDto } from './dto/inventory.dto';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

@Injectable()
export class StockService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
  ) {}

  listBalances(access: EffectiveAccess, branchId: string) {
    return this.db.inOrg(access, async (tx) => {
      await this.requireBranch(tx, branchId);
      const rows = await tx.stockBalance.findMany({
        where: { branchId },
        select: { quantity: true, updatedAt: true, product: { select: { id: true, sku: true, name: true, unit: true } } },
        orderBy: { product: { name: 'asc' } },
      });
      return rows.map((r) => ({ product: r.product, quantity: r.quantity.toFixed(3), updatedAt: r.updatedAt }));
    });
  }

  listMovements(access: EffectiveAccess, branchId: string) {
    return this.db.inOrg(access, async (tx) => {
      await this.requireBranch(tx, branchId);
      const rows = await tx.stockMovement.findMany({ where: { branchId }, orderBy: { createdAt: 'desc' }, take: 100 });
      return rows.map(serializeMovement);
    });
  }

  /**
   * Records a stock adjustment.
   *
   * Concurrency: the balance row is locked with SELECT ... FOR UPDATE, so
   * concurrent adjustments of the same product at the same branch serialize and
   * each sees the previous result. The CHECK (quantity >= 0) constraint is the
   * final backstop.
   *
   * Idempotency: the client supplies an Idempotency-Key. Replaying the same key
   * with the same payload returns the original movement instead of applying it
   * twice; reusing it for a different payload is rejected.
   */
  async adjust(access: EffectiveAccess, branchId: string, dto: StockAdjustmentDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw Errors.badRequest('idempotency_key_required', 'Send an Idempotency-Key header (8-128 characters of [A-Za-z0-9_-])');
    }
    const delta = new Prisma.Decimal(dto.quantityDelta);
    if (delta.isZero()) throw Errors.badRequest('zero_quantity', 'quantityDelta must not be zero');

    try {
      return await this.db.inOrg(access, async (tx) => {
        const replay = await this.findReplay(tx, access.organizationId, idempotencyKey, branchId, dto, delta);
        if (replay) return replay;
        await this.entitlements.assertWritable(tx, access.organizationId);
        await this.requireBranch(tx, branchId, { active: true });
        const product = await tx.product.findFirst({ where: { id: dto.productId, status: 'ACTIVE' }, select: { id: true } });
        if (!product) throw Errors.notFound('Product');

        await tx.$executeRaw`
          INSERT INTO stock_balances (organization_id, branch_id, product_id, quantity, updated_at)
          VALUES (${access.organizationId}::uuid, ${branchId}::uuid, ${dto.productId}::uuid, 0, now())
          ON CONFLICT (branch_id, product_id) DO NOTHING`;
        const [locked] = await tx.$queryRaw<{ quantity: string }[]>`
          SELECT quantity::text AS quantity FROM stock_balances
          WHERE branch_id = ${branchId}::uuid AND product_id = ${dto.productId}::uuid
          FOR UPDATE`;
        const before = new Prisma.Decimal(locked.quantity);
        const after = before.plus(delta);
        if (after.isNegative()) throw Errors.conflict('insufficient_stock', `Only ${before.toFixed(3)} in stock`);

        await tx.stockBalance.update({ where: { branchId_productId: { branchId, productId: dto.productId } }, data: { quantity: after } });
        const movement = await tx.stockMovement.create({
          data: {
            organizationId: access.organizationId, branchId, productId: dto.productId, type: 'ADJUSTMENT',
            quantityDelta: delta, balanceAfter: after, reason: dto.reason.trim(), actorUserId: access.userId, idempotencyKey,
          },
        });
        await this.audit.record(tx, {
          action: 'inventory.stock.adjusted', resourceType: 'stock_movement', resourceId: movement.id,
          organizationId: access.organizationId, branchId, actorUserId: access.userId,
          before: { quantity: before.toFixed(3) }, after: { quantity: after.toFixed(3) },
          metadata: { productId: dto.productId, delta: delta.toFixed(3), reason: movement.reason },
        }, meta);
        return { replayed: false, movement: serializeMovement(movement) };
      });
    } catch (e) {
      // A concurrent request with the same key won the race: return its result.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const replay = await this.db.inOrg(access, (tx) => this.findReplay(tx, access.organizationId, idempotencyKey, branchId, dto, delta));
        if (replay) return replay;
      }
      throw e;
    }
  }

  private async findReplay(tx: Tx, orgId: string, key: string, branchId: string, dto: StockAdjustmentDto, delta: Prisma.Decimal) {
    const existing = await tx.stockMovement.findUnique({ where: { organizationId_idempotencyKey: { organizationId: orgId, idempotencyKey: key } } });
    if (!existing) return null;
    if (existing.branchId !== branchId || existing.productId !== dto.productId || !existing.quantityDelta.equals(delta)) {
      throw Errors.conflict('idempotency_key_reused', 'This Idempotency-Key was already used for a different request');
    }
    return { replayed: true, movement: serializeMovement(existing) };
  }

  /** Archived branches keep their history readable but accept no new stock writes. */
  private async requireBranch(tx: Tx, branchId: string, opts: { active?: boolean } = {}) {
    const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true, status: true } });
    if (!branch) throw Errors.notFound('Branch');
    if (opts.active && branch.status !== 'ACTIVE') throw Errors.conflict('branch_archived', 'This branch is archived and accepts no new transactions');
  }
}

function serializeMovement(m: {
  id: string; branchId: string; productId: string; type: string; quantityDelta: Prisma.Decimal;
  balanceAfter: Prisma.Decimal; reason: string; actorUserId: string; createdAt: Date;
}) {
  return {
    id: m.id, branchId: m.branchId, productId: m.productId, type: m.type,
    quantityDelta: m.quantityDelta.toFixed(3), balanceAfter: m.balanceAfter.toFixed(3),
    reason: m.reason, actorUserId: m.actorUserId, createdAt: m.createdAt,
  };
}
