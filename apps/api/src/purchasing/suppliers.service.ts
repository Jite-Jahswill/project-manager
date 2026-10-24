import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { decodeKeyCursor, encodeKeyCursor, escapeLike } from '../common/cursor';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { can, type EffectiveAccess } from '../authz/permission-evaluator';
import { OrgAuthzService } from '../authz/org-authz.service';
import { Prisma } from '../generated/prisma/client';
import type { CreateSupplierDto, ListSuppliersQuery, SupplierProductDto, UpdateSupplierDto } from '../inventory/dto/inventory.dto';
import { fmtMinor, parseMinor } from '../inventory/quantity';

type SupplierRow = Prisma.SupplierGetPayload<object>;

/** "  ACME   Ltd " and "acme ltd" are the same supplier. */
export const normalizeSupplierName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const versionConflict = (current: number) => Errors.conflict('version_conflict', `The record changed (current version ${current}); reload and retry`);

/**
 * Suppliers: organization-owned business contacts. No personal data beyond what ordering
 * needs (a contact name, business email and phone). Codes and normalized names are unique
 * per organization, so the same supplier cannot be created twice under spelling variants.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly authz: OrgAuthzService,
  ) {}

  list(access: EffectiveAccess, query: ListSuppliersQuery) {
    const limit = query.limit ?? 50;
    const cursor = decodeKeyCursor(query.cursor);
    const q = query.q?.trim();
    return this.db.inOrg(access, async (tx) => {
      const rows = await tx.supplier.findMany({
        where: {
          AND: [
            query.status ? { status: query.status } : {},
            q ? { OR: [{ name: { contains: escapeLike(q), mode: 'insensitive' } }, { code: { contains: escapeLike(q), mode: 'insensitive' } }] } : {},
            cursor ? { OR: [{ nameNormalized: { gt: cursor.key } }, { nameNormalized: cursor.key, id: { gt: cursor.id } }] } : {},
          ],
        },
        orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { items: page.map(view), nextCursor: rows.length > limit ? encodeKeyCursor({ key: last.nameNormalized, id: last.id }) : null };
    });
  }

  get(access: EffectiveAccess, supplierId: string) {
    return this.db.inOrg(access, async (tx) => view(await this.load(tx, supplierId)));
  }

  create(access: EffectiveAccess, dto: CreateSupplierDto, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.authz.lockAndReload(tx, access, 'purchasing.supplier.manage');
      await this.assertUnique(tx, dto.code, dto.name);
      const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: { defaultCurrency: true } });
      const s = await tx.supplier.create({
        data: {
          organizationId: actor.organizationId, code: dto.code, name: dto.name.trim().replace(/\s+/g, ' '), nameNormalized: normalizeSupplierName(dto.name),
          contactName: dto.contactName?.trim() || null, email: dto.email?.trim().toLowerCase() || null, phone: dto.phone?.trim() || null,
          address: dto.address?.trim() || null, taxId: dto.taxId?.trim() || null, paymentTermsDays: dto.paymentTermsDays ?? null,
          currency: dto.currency ?? org.defaultCurrency, notes: dto.notes?.trim() || null,
        },
      });
      await this.audit.record(tx, {
        action: 'purchasing.supplier.created', resourceType: 'supplier', resourceId: s.id, organizationId: actor.organizationId,
        actorUserId: actor.userId, after: { code: s.code, name: s.name, currency: s.currency },
      }, meta);
      return view(s);
    });
  }

  update(access: EffectiveAccess, supplierId: string, dto: UpdateSupplierDto, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.authz.lockAndReload(tx, access, 'purchasing.supplier.manage');
      const before = await this.load(tx, supplierId);
      if (before.version !== dto.version) throw versionConflict(before.version);
      if (dto.name && normalizeSupplierName(dto.name) !== before.nameNormalized) await this.assertUnique(tx, null, dto.name);
      const after = await tx.supplier.update({
        where: { id: supplierId },
        data: {
          ...(dto.name ? { name: dto.name.trim().replace(/\s+/g, ' '), nameNormalized: normalizeSupplierName(dto.name) } : {}),
          ...(dto.contactName !== undefined ? { contactName: dto.contactName.trim() || null } : {}),
          ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() || null } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
          ...(dto.address !== undefined ? { address: dto.address.trim() || null } : {}),
          ...(dto.taxId !== undefined ? { taxId: dto.taxId.trim() || null } : {}),
          ...(dto.paymentTermsDays !== undefined ? { paymentTermsDays: dto.paymentTermsDays } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
          ...(dto.status ? { status: dto.status } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        action: 'purchasing.supplier.updated', resourceType: 'supplier', resourceId: supplierId, organizationId: actor.organizationId,
        actorUserId: actor.userId, before: { name: before.name, status: before.status }, after: { name: after.name, status: after.status },
        metadata: { fields: Object.keys(dto).filter((k) => k !== 'version') },
      }, meta);
      return view(after);
    });
  }

  listProducts(access: EffectiveAccess, supplierId: string) {
    return this.db.inOrg(access, async (tx) => {
      await this.load(tx, supplierId);
      const rows = await tx.supplierProduct.findMany({
        where: { supplierId }, include: { product: { select: { id: true, sku: true, name: true, unit: true, status: true } } }, orderBy: { productId: 'asc' }, take: 1000,
      });
      const costs = can(access, 'inventory.cost.read');
      return {
        items: rows.map((r) => ({
          product: r.product, supplierSku: r.supplierSku, leadTimeDays: r.leadTimeDays,
          ...(costs ? { defaultUnitCostMinor: fmtMinor(r.defaultUnitCostMinor) } : {}),
        })),
      };
    });
  }

  setProduct(access: EffectiveAccess, supplierId: string, productId: string, dto: SupplierProductDto, meta: RequestMeta) {
    const cost = parseMinor(dto.defaultUnitCostMinor, 'defaultUnitCostMinor');
    if (cost !== null && !can(access, 'inventory.cost.read')) throw Errors.forbidden('Setting a cost requires inventory.cost.read');
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.authz.lockAndReload(tx, access, 'purchasing.supplier.manage');
      await this.load(tx, supplierId);
      const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, status: true } });
      if (!product || product.status === 'ARCHIVED') throw Errors.notFound('Product');
      const data = { supplierSku: dto.supplierSku ?? null, defaultUnitCostMinor: cost, leadTimeDays: dto.leadTimeDays ?? null };
      await tx.supplierProduct.upsert({
        where: { supplierId_productId: { supplierId, productId } },
        create: { organizationId: actor.organizationId, supplierId, productId, ...data }, update: data,
      });
      await this.audit.record(tx, {
        action: 'purchasing.supplier.product_linked', resourceType: 'supplier', resourceId: supplierId, organizationId: actor.organizationId,
        actorUserId: actor.userId, metadata: { productId, supplierSku: data.supplierSku, costSet: cost !== null, leadTimeDays: data.leadTimeDays },
      }, meta);
      return { supplierId, productId, supplierSku: data.supplierSku, leadTimeDays: data.leadTimeDays };
    });
  }

  removeProduct(access: EffectiveAccess, supplierId: string, productId: string, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.authz.lockAndReload(tx, access, 'purchasing.supplier.manage');
      const removed = await tx.supplierProduct.deleteMany({ where: { supplierId, productId } });
      if (!removed.count) throw Errors.notFound('Supplier product');
      await this.audit.record(tx, {
        action: 'purchasing.supplier.product_unlinked', resourceType: 'supplier', resourceId: supplierId, organizationId: actor.organizationId,
        actorUserId: actor.userId, metadata: { productId },
      }, meta);
    });
  }

  /**
   * Purchase history (purchasing.report.read): orders by status, value ordered, value received
   * (received quantities at order cost, net of returns) and the open commitment. There is no
   * invoice or payment ledger yet, so no "amount owed" is reported.
   */
  summary(access: EffectiveAccess, supplierId: string) {
    return this.db.inOrg(access, async (tx) => {
      const s = await this.load(tx, supplierId);
      const byStatus = await tx.purchaseOrder.groupBy({ by: ['status'], where: { supplierId }, _count: { _all: true }, _sum: { subtotalMinor: true } });
      const [values] = await tx.$queryRaw<{ received: string | null; open: string | null }[]>`
        SELECT sum(round((l.quantity_received - l.quantity_returned) * l.unit_cost_minor))::text AS received,
               sum(CASE WHEN po.status IN ('APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED')
                        THEN round((l.quantity_ordered - l.quantity_received) * l.unit_cost_minor) ELSE 0 END)::text AS open
        FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
        WHERE po.supplier_id = ${supplierId}::uuid AND po.status <> 'CANCELLED'`;
      const recent = await tx.purchaseOrder.findMany({
        where: { supplierId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20,
        select: { id: true, number: true, status: true, branchId: true, subtotalMinor: true, currency: true, createdAt: true },
      });
      return {
        supplier: { id: s.id, code: s.code, name: s.name, currency: s.currency },
        orders: Object.fromEntries(byStatus.map((r) => [r.status, { count: r._count._all, valueMinor: fmtMinor(r._sum.subtotalMinor ?? 0n) }])),
        receivedValueMinor: values?.received ?? '0', openCommitmentMinor: values?.open ?? '0',
        recentOrders: recent.map((o) => ({ ...o, subtotalMinor: fmtMinor(o.subtotalMinor) })),
      };
    });
  }

  private async load(tx: Tx, supplierId: string): Promise<SupplierRow> {
    const s = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!s) throw Errors.notFound('Supplier');
    return s;
  }

  private async assertUnique(tx: Tx, code: string | null, name: string) {
    if (code && (await tx.supplier.findFirst({ where: { code }, select: { id: true } }))) throw Errors.conflict('supplier_code_taken', 'A supplier with this code already exists');
    if (await tx.supplier.findFirst({ where: { nameNormalized: normalizeSupplierName(name) }, select: { id: true } })) {
      throw Errors.conflict('supplier_name_taken', 'A supplier with this name already exists');
    }
  }
}

function view(s: SupplierRow) {
  return {
    id: s.id, code: s.code, name: s.name, status: s.status, contactName: s.contactName, email: s.email, phone: s.phone, address: s.address,
    taxId: s.taxId, paymentTermsDays: s.paymentTermsDays, currency: s.currency, notes: s.notes, version: s.version, createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}
