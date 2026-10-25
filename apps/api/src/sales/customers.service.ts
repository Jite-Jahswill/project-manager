import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { decodeKeyCursor, encodeKeyCursor, escapeLike } from '../common/cursor';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import { Prisma } from '../generated/prisma/client';
import type { CreateCustomerDto, ListCustomersQuery, UpdateCustomerDto } from './dto/sales.dto';

type CustomerRow = Prisma.CustomerGetPayload<object>;

export const normalizeCustomerEmail = (e: string) => e.trim().toLowerCase();

/** "+234 (803) 000-0000" -> "+2348030000000". Digits only, optional leading +, 6-15 digits. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  const out = (trimmed.startsWith('+') ? '+' : '') + digits;
  if (!/^\+?[0-9]{6,15}$/.test(out)) throw Errors.badRequest('invalid_phone', 'Phone numbers have 6 to 15 digits');
  return out;
}

/**
 * Which customers a caller may see. sales.customer.read is organization-scoped but
 * branch-assignable: an organization-wide grant sees every customer; a grant attached to
 * branch assignments sees only the customers registered at those branches.
 */
export function customerScope(access: EffectiveAccess, key = 'sales.customer.read'): 'ALL' | string[] {
  if (access.isOwner) return 'ALL';
  if (access.denies.some((d) => d.permission === key && d.branchId === null)) return [];
  if (access.grants.some((g) => g.permission === key && g.branchId === null)) return 'ALL';
  const denied = new Set(access.denies.filter((d) => d.permission === key).map((d) => d.branchId));
  return [...new Set(access.grants.filter((g) => g.permission === key && g.branchId && !denied.has(g.branchId)).map((g) => g.branchId as string))];
}

const versionConflict = (current: number) => Errors.conflict('version_conflict', `The record changed (current version ${current}); reload and retry`);

/** Retail customers. Collect only what selling needs: a name and optional contact details. */
@Injectable()
export class CustomersService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  list(access: EffectiveAccess, q: ListCustomersQuery) {
    const scope = customerScope(access);
    const limit = q.limit ?? 50;
    const cursor = decodeKeyCursor(q.cursor);
    const search = q.q?.trim();
    if (scope !== 'ALL' && (scope.length === 0 || (q.branchId && !scope.includes(q.branchId)))) return Promise.resolve({ items: [], nextCursor: null });
    return this.db.inOrg(access, async (tx) => {
      const rows = await tx.customer.findMany({
        where: {
          AND: [
            scope === 'ALL' ? {} : { homeBranchId: { in: scope } },
            q.branchId ? { homeBranchId: q.branchId } : {}, q.status ? { status: q.status } : {},
            search ? { OR: [
              { name: { contains: escapeLike(search), mode: 'insensitive' } }, { email: { contains: escapeLike(search.toLowerCase()) } },
              { phone: { contains: escapeLike(search.replace(/[^0-9+]/g, '') || search) } },
            ] } : {},
            cursor ? { OR: [{ name: { gt: cursor.key } }, { name: cursor.key, id: { gt: cursor.id } }] } : {},
          ],
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { items: page.map(view), nextCursor: rows.length > limit ? encodeKeyCursor({ key: last.name, id: last.id }) : null };
    });
  }

  get(access: EffectiveAccess, customerId: string) {
    return this.db.inOrg(access, async (tx) => view(await this.visible(tx, access, customerId)));
  }

  create(access: EffectiveAccess, dto: CreateCustomerDto, meta: RequestMeta) {
    const email = dto.email ? normalizeCustomerEmail(dto.email) : null;
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    return this.db.inOrg(access, async (tx) => {
      if (dto.homeBranchId) {
        const b = await tx.branch.findUnique({ where: { id: dto.homeBranchId }, select: { status: true } });
        if (!b || b.status !== 'ACTIVE') throw Errors.notFound('Branch');
      }
      await this.assertUnique(tx, email, phone, null);
      const c = await tx.customer.create({
        data: {
          organizationId: access.organizationId, name: dto.name.trim(), email, phone, notes: dto.notes?.trim() || null,
          homeBranchId: dto.homeBranchId ?? null, createdByUserId: access.userId,
        },
      }).catch(uniqueConflict);
      // Personal data stays out of the audit log: record which fields were provided.
      await this.audit.record(tx, {
        action: 'sales.customer.created', resourceType: 'customer', resourceId: c.id, organizationId: access.organizationId,
        branchId: c.homeBranchId, actorUserId: access.userId, metadata: { hasEmail: !!email, hasPhone: !!phone, homeBranchId: c.homeBranchId },
      }, meta);
      return view(c);
    });
  }

  update(access: EffectiveAccess, customerId: string, dto: UpdateCustomerDto, meta: RequestMeta) {
    const email = dto.email === undefined ? undefined : dto.email === null ? null : normalizeCustomerEmail(dto.email);
    const phone = dto.phone === undefined ? undefined : dto.phone === null ? null : normalizePhone(dto.phone);
    return this.db.inOrg(access, async (tx) => {
      // Row lock: concurrent edits serialize; the version decides which one wins.
      const [locked] = await tx.$queryRaw<{ version: number }[]>`SELECT version FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
      if (!locked) throw Errors.notFound('Customer');
      const before = await this.visible(tx, access, customerId);
      if (before.version !== dto.version) throw versionConflict(before.version);
      await this.assertUnique(tx, email ?? null, phone ?? null, customerId);
      const after = await tx.customer.update({
        where: { id: customerId },
        data: {
          ...(dto.name ? { name: dto.name.trim() } : {}), ...(email !== undefined ? { email } : {}), ...(phone !== undefined ? { phone } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes?.trim() || null } : {}), ...(dto.status ? { status: dto.status } : {}),
          version: { increment: 1 },
        },
      }).catch(uniqueConflict);
      await this.audit.record(tx, {
        action: dto.status && dto.status !== before.status ? (dto.status === 'INACTIVE' ? 'sales.customer.deactivated' : 'sales.customer.reactivated') : 'sales.customer.updated',
        resourceType: 'customer', resourceId: customerId, organizationId: access.organizationId, branchId: before.homeBranchId,
        actorUserId: access.userId, metadata: { fields: Object.keys(dto).filter((k) => k !== 'version') },
      }, meta);
      return view(after);
    });
  }

  /** The customer if the caller's scope covers it (404 otherwise: existence is not revealed). */
  async visible(tx: Tx, access: EffectiveAccess, customerId: string): Promise<CustomerRow> {
    const c = await tx.customer.findUnique({ where: { id: customerId } });
    const scope = customerScope(access);
    if (!c || (scope !== 'ALL' && (!c.homeBranchId || !scope.includes(c.homeBranchId)))) throw Errors.notFound('Customer');
    return c;
  }

  private async assertUnique(tx: Tx, email: string | null, phone: string | null, exceptId: string | null) {
    if (email && (await tx.customer.findFirst({ where: { email, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }))) {
      throw Errors.conflict('customer_email_taken', 'Another customer already uses this email address');
    }
    if (phone && (await tx.customer.findFirst({ where: { phone, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } }))) {
      throw Errors.conflict('customer_phone_taken', 'Another customer already uses this phone number');
    }
  }
}

function uniqueConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    if (/phone/.test(JSON.stringify(e.meta ?? {}))) throw Errors.conflict('customer_phone_taken', 'Another customer already uses this phone number');
    throw Errors.conflict('customer_email_taken', 'Another customer already uses this email address');
  }
  throw e;
}

function view(c: CustomerRow) {
  return {
    id: c.id, name: c.name, email: c.email, phone: c.phone, notes: c.notes, status: c.status, homeBranchId: c.homeBranchId,
    version: c.version, createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}
