import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { decodeKeyCursor, encodeKeyCursor, escapeLike } from '../common/cursor';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { can, type EffectiveAccess } from '../authz/permission-evaluator';
import { OrgAuthzService } from '../authz/org-authz.service';
import { Prisma } from '../generated/prisma/client';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { ENTITLEMENTS } from '../subscriptions/entitlements';
import type { CreateCategoryDto, CreateProductDto, ListProductsQuery, UpdateCategoryDto, UpdateProductDto } from './dto/inventory.dto';
import { fmtMinor, fmtQty, parseMinor, parseQuantity, scaleOfUnit } from './quantity';

type ProductRow = Prisma.ProductGetPayload<{ include: { category: { select: { id: true; name: true } } } }>;

const versionConflict = (current: number) => Errors.conflict('version_conflict', `The record changed (current version ${current}); reload and retry`);
const OPEN_ORDER_STATUSES = ['SUBMITTED', 'APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED'] as const;

/** Duplicate SKU or barcode raced past the pre-check: report which one. */
function uniqueConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    const target = JSON.stringify(e.meta ?? {});
    if (/barcode/.test(target)) throw Errors.conflict('barcode_taken', 'Another product already has this barcode');
    throw Errors.conflict('sku_taken', 'A product with this SKU already exists');
  }
  throw e;
}

/**
 * Product catalogue and categories. Products belong to one organization (RLS + composite
 * keys); SKU and barcode are unique per organization. Cost prices are restricted
 * (inventory.cost.read): hidden from readers without it and only settable with it.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
    private readonly authz: OrgAuthzService,
  ) {}

  // ---------------------------------------------------------------- categories

  listCategories(access: EffectiveAccess, status?: 'ACTIVE' | 'ARCHIVED') {
    return this.db.inOrg(access, (tx) => tx.productCategory.findMany({
      where: status ? { status } : {}, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 1000,
      select: { id: true, name: true, parentId: true, status: true, version: true, createdAt: true, updatedAt: true },
    }));
  }

  createCategory(access: EffectiveAccess, dto: CreateCategoryDto, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.authz.lockAndReload(tx, access, 'inventory.category.manage');
      if (dto.parentId) await this.assertParent(tx, dto.parentId);
      await this.assertCategoryNameFree(tx, dto.name);
      const c = await tx.productCategory.create({
        data: { organizationId: actor.organizationId, name: dto.name.trim(), nameNormalized: dto.name.trim().toLowerCase(), parentId: dto.parentId ?? null },
        select: { id: true, name: true, parentId: true, status: true, version: true, createdAt: true, updatedAt: true },
      });
      await this.audit.record(tx, {
        action: 'inventory.category.created', resourceType: 'product_category', resourceId: c.id, organizationId: actor.organizationId,
        actorUserId: actor.userId, after: { name: c.name, parentId: c.parentId },
      }, meta);
      return c;
    });
  }

  updateCategory(access: EffectiveAccess, categoryId: string, dto: UpdateCategoryDto, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.authz.lockAndReload(tx, access, 'inventory.category.manage');
      const before = await tx.productCategory.findUnique({ where: { id: categoryId } });
      if (!before) throw Errors.notFound('Category');
      if (before.version !== dto.version) throw versionConflict(before.version);
      if (before.status === 'ARCHIVED') throw Errors.conflict('category_archived', 'Archived categories cannot be edited');
      if (dto.name && dto.name.trim().toLowerCase() !== before.nameNormalized) await this.assertCategoryNameFree(tx, dto.name);
      if (dto.parentId) {
        if (dto.parentId === categoryId) throw Errors.badRequest('invalid_parent', 'A category cannot be its own parent');
        await this.assertParent(tx, dto.parentId);
        if (await tx.productCategory.count({ where: { parentId: categoryId } })) {
          throw Errors.badRequest('invalid_parent', 'A category with sub-categories cannot itself become a sub-category');
        }
      }
      const after = await tx.productCategory.update({
        where: { id: categoryId },
        data: {
          ...(dto.name ? { name: dto.name.trim(), nameNormalized: dto.name.trim().toLowerCase() } : {}),
          ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}), version: { increment: 1 },
        },
        select: { id: true, name: true, parentId: true, status: true, version: true, createdAt: true, updatedAt: true },
      });
      await this.audit.record(tx, {
        action: 'inventory.category.updated', resourceType: 'product_category', resourceId: categoryId, organizationId: actor.organizationId,
        actorUserId: actor.userId, before: { name: before.name, parentId: before.parentId }, after: { name: after.name, parentId: after.parentId },
      }, meta);
      return after;
    });
  }

  /** Archived categories keep their products (history); they just cannot be chosen any more. */
  archiveCategory(access: EffectiveAccess, categoryId: string, version: number, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.authz.lockAndReload(tx, access, 'inventory.category.manage');
      const before = await tx.productCategory.findUnique({ where: { id: categoryId } });
      if (!before) throw Errors.notFound('Category');
      if (before.version !== version) throw versionConflict(before.version);
      if (before.status === 'ARCHIVED') throw Errors.conflict('category_archived', 'The category is already archived');
      if (await tx.productCategory.count({ where: { parentId: categoryId, status: 'ACTIVE' } })) {
        throw Errors.conflict('category_has_children', 'Archive or move its sub-categories first');
      }
      const after = await tx.productCategory.update({ where: { id: categoryId }, data: { status: 'ARCHIVED', version: { increment: 1 } } });
      await this.audit.record(tx, {
        action: 'inventory.category.archived', resourceType: 'product_category', resourceId: categoryId, organizationId: actor.organizationId,
        actorUserId: actor.userId, before: { status: before.status }, after: { status: after.status },
      }, meta);
      return { id: after.id, name: after.name, parentId: after.parentId, status: after.status, version: after.version };
    });
  }

  private async assertParent(tx: Tx, parentId: string) {
    const parent = await tx.productCategory.findUnique({ where: { id: parentId }, select: { status: true, parentId: true } });
    if (!parent || parent.status !== 'ACTIVE') throw Errors.notFound('Parent category');
    if (parent.parentId) throw Errors.badRequest('invalid_parent', 'Categories can be nested one level only');
  }

  private async assertCategoryNameFree(tx: Tx, name: string) {
    if (await tx.productCategory.findFirst({ where: { nameNormalized: name.trim().toLowerCase() }, select: { id: true } })) {
      throw Errors.conflict('category_name_taken', 'A category with this name already exists');
    }
  }

  // ---------------------------------------------------------------- products

  /**
   * Search matches the name, SKU or barcode (case-insensitive, substring). `%`, `_` and `\`
   * are matched literally (escaped); the value is always a bound parameter.
   */
  list(access: EffectiveAccess, query: ListProductsQuery) {
    const limit = query.limit ?? 50;
    const cursor = decodeKeyCursor(query.cursor);
    const q = query.q?.trim();
    const like = q ? escapeLike(q) : null;
    return this.db.inOrg(access, async (tx) => {
      const rows = await tx.product.findMany({
        where: {
          AND: [
            { status: query.status ?? 'ACTIVE' },
            query.categoryId ? { categoryId: query.categoryId } : {},
            like ? { OR: [
              { name: { contains: like, mode: 'insensitive' } }, { sku: { contains: like, mode: 'insensitive' } },
              { barcode: { contains: like, mode: 'insensitive' } },
            ] } : {},
            cursor ? { OR: [{ name: { gt: cursor.key } }, { name: cursor.key, id: { gt: cursor.id } }] } : {},
          ],
        },
        include: { category: { select: { id: true, name: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { items: page.map((p) => this.view(access, p)), nextCursor: rows.length > limit ? encodeKeyCursor({ key: last.name, id: last.id }) : null };
    });
  }

  get(access: EffectiveAccess, productId: string) {
    return this.db.inOrg(access, async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId }, include: { category: { select: { id: true, name: true } } } });
      if (!product) throw Errors.notFound('Product');
      return this.view(access, product);
    });
  }

  create(access: EffectiveAccess, dto: CreateProductDto, meta: RequestMeta) {
    const unit = dto.unit ?? 'each';
    const scale = scaleOfUnit(unit);
    const cost = parseMinor(dto.costPriceMinor, 'costPriceMinor');
    if (cost !== null && !can(access, 'inventory.cost.read')) throw Errors.forbidden('Setting a cost price requires inventory.cost.read');
    const price = parseMinor(dto.sellingPriceMinor, 'sellingPriceMinor');
    const reorder = dto.reorderLevel !== undefined ? parseQuantity(dto.reorderLevel, scale, 'nonnegative', 'reorderLevel') : null;
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertBelowLimit(tx, access.organizationId, ENTITLEMENTS.products, () => tx.product.count({ where: { status: { not: 'ARCHIVED' } } }));
      if (await tx.product.findFirst({ where: { sku: dto.sku }, select: { id: true } })) throw Errors.conflict('sku_taken', 'A product with this SKU already exists');
      if (dto.barcode && (await tx.product.findFirst({ where: { barcode: dto.barcode }, select: { id: true } }))) {
        throw Errors.conflict('barcode_taken', 'Another product already has this barcode');
      }
      if (dto.categoryId) await this.assertCategoryUsable(tx, dto.categoryId);
      const org = await tx.organization.findUniqueOrThrow({ where: { id: access.organizationId }, select: { defaultCurrency: true } });
      const product = await tx.product.create({
        data: {
          organizationId: access.organizationId, sku: dto.sku, name: dto.name.trim(), unit, quantityScale: scale,
          description: dto.description?.trim() || null, categoryId: dto.categoryId ?? null, barcode: dto.barcode ?? null,
          costPriceMinor: cost, sellingPriceMinor: price, currency: org.defaultCurrency, reorderLevel: reorder,
        },
        include: { category: { select: { id: true, name: true } } },
      }).catch(uniqueConflict);
      await this.audit.record(tx, {
        action: 'inventory.product.created', resourceType: 'product', resourceId: product.id,
        organizationId: access.organizationId, actorUserId: access.userId,
        after: { sku: product.sku, name: product.name, unit, barcode: product.barcode, categoryId: product.categoryId, costSet: cost !== null },
      }, meta);
      return this.view(access, product);
    });
  }

  update(access: EffectiveAccess, productId: string, dto: UpdateProductDto, meta: RequestMeta) {
    if (dto.costPriceMinor !== undefined && !can(access, 'inventory.cost.read')) throw Errors.forbidden('Changing a cost price requires inventory.cost.read');
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertWritable(tx, access.organizationId);
      const before = await tx.product.findUnique({ where: { id: productId }, include: { category: { select: { id: true, name: true } } } });
      if (!before) throw Errors.notFound('Product');
      if (before.version !== dto.version) throw versionConflict(before.version);
      if (before.status === 'ARCHIVED') throw Errors.conflict('product_archived', 'Archived products cannot be edited');
      let scale = before.quantityScale;
      if (dto.unit && dto.unit !== before.unit) {
        // Unit compatibility: existing quantities were recorded in the old unit.
        const [moves, lines] = await Promise.all([
          tx.stockMovement.count({ where: { productId } }), tx.purchaseOrderLine.count({ where: { productId } }),
        ]);
        if (moves || lines) throw Errors.conflict('unit_locked', 'The unit cannot change once the product has stock history or order lines');
        scale = scaleOfUnit(dto.unit);
      }
      if (dto.barcode && dto.barcode !== before.barcode && (await tx.product.findFirst({ where: { barcode: dto.barcode }, select: { id: true } }))) {
        throw Errors.conflict('barcode_taken', 'Another product already has this barcode');
      }
      if (dto.categoryId) await this.assertCategoryUsable(tx, dto.categoryId);
      const data: Prisma.ProductUpdateInput = { version: { increment: 1 } };
      if (dto.name) data.name = dto.name.trim();
      if (dto.unit) { data.unit = dto.unit; data.quantityScale = scale; }
      if (dto.description !== undefined) data.description = dto.description?.trim() || null;
      if (dto.categoryId !== undefined) data.category = dto.categoryId ? { connect: { id_organizationId: { id: dto.categoryId, organizationId: access.organizationId } } } : { disconnect: true };
      if (dto.barcode !== undefined) data.barcode = dto.barcode;
      if (dto.costPriceMinor !== undefined) data.costPriceMinor = parseMinor(dto.costPriceMinor, 'costPriceMinor');
      if (dto.sellingPriceMinor !== undefined) data.sellingPriceMinor = parseMinor(dto.sellingPriceMinor, 'sellingPriceMinor');
      if (dto.reorderLevel !== undefined) data.reorderLevel = dto.reorderLevel === null ? null : parseQuantity(dto.reorderLevel, scale, 'nonnegative', 'reorderLevel');
      if (dto.status) data.status = dto.status;
      const after = await tx.product.update({ where: { id: productId }, data, include: { category: { select: { id: true, name: true } } } }).catch(uniqueConflict);
      const changed = (k: keyof ProductRow) => String(before[k]) !== String(after[k]);
      await this.audit.record(tx, {
        action: 'inventory.product.updated', resourceType: 'product', resourceId: productId, organizationId: access.organizationId, actorUserId: access.userId,
        before: pick(before, ['name', 'unit', 'barcode', 'categoryId', 'status', 'reorderLevel', 'sellingPriceMinor']),
        after: pick(after, ['name', 'unit', 'barcode', 'categoryId', 'status', 'reorderLevel', 'sellingPriceMinor']),
        metadata: { costChanged: changed('costPriceMinor') },
      }, meta);
      return this.view(access, after);
    });
  }

  /**
   * Products are archived, never deleted: stock history and orders reference them. Not while
   * stock is on hand at any branch or the product is on an open purchase order.
   */
  archive(access: EffectiveAccess, productId: string, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertWritable(tx, access.organizationId);
      const before = await tx.product.findUnique({ where: { id: productId }, include: { category: { select: { id: true, name: true } } } });
      if (!before) throw Errors.notFound('Product');
      if (before.status === 'ARCHIVED') return this.view(access, before);
      if (await tx.stockBalance.count({ where: { productId, quantity: { gt: 0 } } })) {
        throw Errors.conflict('stock_on_hand', 'Move or adjust out the remaining stock before archiving');
      }
      if (await tx.purchaseOrderLine.count({ where: { productId, purchaseOrder: { status: { in: [...OPEN_ORDER_STATUSES] } } } })) {
        throw Errors.conflict('open_purchase_orders', 'The product is on open purchase orders');
      }
      const after = await tx.product.update({ where: { id: productId }, data: { status: 'ARCHIVED', version: { increment: 1 } }, include: { category: { select: { id: true, name: true } } } });
      await this.audit.record(tx, {
        action: 'inventory.product.archived', resourceType: 'product', resourceId: productId,
        organizationId: access.organizationId, actorUserId: access.userId, before: { status: before.status }, after: { status: after.status },
      }, meta);
      return this.view(access, after);
    });
  }

  private async assertCategoryUsable(tx: Tx, categoryId: string) {
    const c = await tx.productCategory.findUnique({ where: { id: categoryId }, select: { status: true } });
    if (!c || c.status !== 'ACTIVE') throw Errors.notFound('Category');
  }

  /** Cost prices only for holders of inventory.cost.read. */
  view(access: EffectiveAccess, p: ProductRow) {
    return {
      id: p.id, sku: p.sku, name: p.name, unit: p.unit, quantityScale: p.quantityScale, status: p.status, description: p.description,
      category: p.category ? { id: p.category.id, name: p.category.name } : null, barcode: p.barcode, currency: p.currency,
      sellingPriceMinor: fmtMinor(p.sellingPriceMinor),
      ...(can(access, 'inventory.cost.read') ? { costPriceMinor: fmtMinor(p.costPriceMinor) } : {}),
      reorderLevel: p.reorderLevel === null ? null : fmtQty(p.reorderLevel), version: p.version, createdAt: p.createdAt, updatedAt: p.updatedAt,
    };
  }
}

function pick<T extends object>(o: T, keys: (keyof T)[]) {
  return Object.fromEntries(keys.map((k) => [k, typeof o[k] === 'bigint' ? String(o[k]) : o[k] instanceof Prisma.Decimal ? String(o[k]) : o[k]]));
}
