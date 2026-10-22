import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb } from '../database/tenant-db.service';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { ENTITLEMENTS } from '../subscriptions/entitlements';
import type { CreateProductDto, ListProductsQuery, UpdateProductDto } from './dto/inventory.dto';

const PRODUCT_SELECT = { id: true, sku: true, name: true, unit: true, status: true, createdAt: true, updatedAt: true } as const;

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
  ) {}

  list(access: EffectiveAccess, query: ListProductsQuery) {
    return this.db.inOrg(access, (tx) =>
      tx.product.findMany({
        where: {
          status: query.status ?? 'ACTIVE',
          ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { sku: { contains: query.q, mode: 'insensitive' } }] } : {}),
        },
        select: PRODUCT_SELECT,
        orderBy: { name: 'asc' },
        take: 200,
      }),
    );
  }

  get(access: EffectiveAccess, productId: string) {
    return this.db.inOrg(access, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId }, select: PRODUCT_SELECT });
      if (!product) throw Errors.notFound('Product');
      return product;
    });
  }

  create(access: EffectiveAccess, dto: CreateProductDto, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertBelowLimit(tx, access.organizationId, ENTITLEMENTS.products, () =>
        tx.product.count({ where: { status: 'ACTIVE' } }),
      );
      if (await tx.product.findFirst({ where: { sku: dto.sku }, select: { id: true } })) {
        throw Errors.conflict('sku_taken', 'A product with this SKU already exists');
      }
      const product = await tx.product.create({
        data: { organizationId: access.organizationId, sku: dto.sku, name: dto.name.trim(), unit: dto.unit ?? 'each' },
        select: PRODUCT_SELECT,
      });
      await this.audit.record(tx, {
        action: 'inventory.product.created', resourceType: 'product', resourceId: product.id,
        organizationId: access.organizationId, actorUserId: access.userId, after: product,
      }, meta);
      return product;
    });
  }

  update(access: EffectiveAccess, productId: string, dto: UpdateProductDto, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertWritable(tx, access.organizationId);
      const before = await tx.product.findUnique({ where: { id: productId }, select: PRODUCT_SELECT });
      if (!before) throw Errors.notFound('Product');
      if (before.status === 'ARCHIVED') throw Errors.conflict('product_archived', 'Archived products cannot be edited');
      const after = await tx.product.update({
        where: { id: productId },
        data: { ...(dto.name ? { name: dto.name.trim() } : {}), ...(dto.unit ? { unit: dto.unit } : {}) },
        select: PRODUCT_SELECT,
      });
      await this.audit.record(tx, {
        action: 'inventory.product.updated', resourceType: 'product', resourceId: productId,
        organizationId: access.organizationId, actorUserId: access.userId, before, after,
      }, meta);
      return after;
    });
  }

  /** Products are archived, never deleted: stock history keeps referencing them. */
  archive(access: EffectiveAccess, productId: string, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertWritable(tx, access.organizationId);
      const before = await tx.product.findUnique({ where: { id: productId }, select: PRODUCT_SELECT });
      if (!before) throw Errors.notFound('Product');
      const after = await tx.product.update({ where: { id: productId }, data: { status: 'ARCHIVED' }, select: PRODUCT_SELECT });
      await this.audit.record(tx, {
        action: 'inventory.product.archived', resourceType: 'product', resourceId: productId,
        organizationId: access.organizationId, actorUserId: access.userId, before: { status: before.status }, after: { status: after.status },
      }, meta);
      return after;
    });
  }
}
