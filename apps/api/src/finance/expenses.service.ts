import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { ApiError, Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { branchesWith, can, type EffectiveAccess } from '../authz/permission-evaluator';
import { Prisma } from '../generated/prisma/client';
import { idempotencyReused, requireIdempotencyKey } from '../inventory/ledger';
import { fmtMinor } from '../inventory/quantity';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { AttachmentObjects } from '../storage/attachment-objects.service';
import { AttachmentRejected, sanitizeFileName, validateAttachment } from '../support/attachments';
import type {
  CancelExpenseDto, CreateExpenseCategoryDto, CreateExpenseDto, ExpenseReasonDto, ExpenseVersionDto, ListExpensesQuery, UpdateExpenseCategoryDto,
  UpdateExpenseDto,
} from './dto/finance.dto';
import { cleanReference, fmtDate, optionalPeriod, parseOccurredOn, positiveAmount } from './finance-common';

type Status = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'VOIDED';
interface Locked { id: string; status: Status; version: number; branch_id: string | null; created_by_user_id: string; number: string; currency: string; amount_minor: bigint }
type ExpenseRow = Prisma.ExpenseGetPayload<{ include: { category: { select: { id: true; name: true } } } }>;

export const MAX_ATTACHMENTS_PER_EXPENSE = 10;
const versionConflict = (current: number) => Errors.conflict('version_conflict', `The expense changed (current version ${current}); reload and retry`);
const wrongStatus = (status: string, action: string) => Errors.conflict('invalid_status', `A ${status} expense cannot be ${action}`);
const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Expenses (docs/architecture/13-finance.md §2).
 *
 *   DRAFT ─submit→ SUBMITTED ─approve→ APPROVED ─void→ VOIDED
 *     │               │reject→ REJECTED
 *     └──cancel───────┴cancel→ CANCELLED
 *
 * Only drafts are edited, and only by their creator. Every transition locks the expense row,
 * checks the caller's version and permissions, and writes the change, an event and an audit
 * record in one transaction; the database re-checks the transition, the immutability of what
 * was submitted and that nobody decides on (or voids) their own expense. Approved amounts are
 * changed only by an explicit void plus a new expense that `correctsExpenseId` the voided one.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
    private readonly objects: AttachmentObjects,
  ) {}

  // ---------------------------------------------------------------- categories

  listCategories(access: EffectiveAccess) {
    if (!this.anyFinanceRole(access)) throw Errors.forbidden();
    return this.db.inOrg(access, async (tx) => {
      const rows = await tx.expenseCategory.findMany({ orderBy: [{ status: 'asc' }, { normalizedName: 'asc' }], take: 500 });
      return { items: rows.map(categoryView) };
    });
  }

  async createCategory(access: EffectiveAccess, dto: CreateExpenseCategoryDto, meta: RequestMeta) {
    try {
      return await this.db.inOrg(access, async (tx) => {
        await this.entitlements.assertWritable(tx, access.organizationId);
        const c = await tx.expenseCategory.create({
          data: {
            organizationId: access.organizationId, name: dto.name.trim().replace(/\s+/g, ' '), normalizedName: normalizeName(dto.name),
            description: dto.description?.trim() || null, createdByUserId: access.userId,
          },
        });
        await this.audit.record(tx, {
          action: 'finance.category.created', resourceType: 'expense_category', resourceId: c.id, organizationId: access.organizationId,
          actorUserId: access.userId, after: { name: c.name },
        }, meta);
        return categoryView(c);
      });
    } catch (e) {
      throw categoryNameTaken(e);
    }
  }

  async updateCategory(access: EffectiveAccess, categoryId: string, dto: UpdateExpenseCategoryDto, meta: RequestMeta) {
    try {
      return await this.db.inOrg(access, async (tx) => {
        const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM expense_categories WHERE id = ${categoryId}::uuid FOR UPDATE`;
        if (!locked) throw Errors.notFound('Expense category');
        const before = await tx.expenseCategory.findUniqueOrThrow({ where: { id: categoryId } });
        if (before.version !== dto.version) throw Errors.conflict('version_conflict', `The category changed (current version ${before.version}); reload and retry`);
        const c = await tx.expenseCategory.update({
          where: { id: categoryId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim().replace(/\s+/g, ' '), normalizedName: normalizeName(dto.name) } : {}),
            ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
            ...(dto.status ? { status: dto.status } : {}),
            version: { increment: 1 },
          },
        });
        await this.audit.record(tx, {
          action: 'finance.category.updated', resourceType: 'expense_category', resourceId: c.id, organizationId: access.organizationId,
          actorUserId: access.userId, before: { name: before.name, status: before.status }, after: { name: c.name, status: c.status },
        }, meta);
        return categoryView(c);
      });
    } catch (e) {
      throw categoryNameTaken(e);
    }
  }

  // ---------------------------------------------------------------- expenses: reads

  list(access: EffectiveAccess, q: ListExpensesQuery) {
    const limit = q.limit ?? 50;
    const cursor = decodeCursor(q.cursor);
    const period = optionalPeriod(q.from, q.to);
    const scope = this.readScope(access);
    if (q.branchId && scope !== 'ALL' && !scope.includes(q.branchId) && q.createdBy !== 'me') {
      // Branch-limited readers may still filter their own expenses at any branch.
      return Promise.resolve({ items: [], nextCursor: null });
    }
    return this.db.inOrg(access, async (tx) => {
      const visible: Prisma.ExpenseWhereInput = scope === 'ALL' ? {} : { OR: [{ createdByUserId: access.userId }, ...(scope.length ? [{ branchId: { in: scope } }] : [])] };
      const rows = await tx.expense.findMany({
        where: {
          AND: [
            visible,
            q.createdBy === 'me' ? { createdByUserId: access.userId } : {},
            q.status ? { status: q.status } : {},
            q.branchId ? { branchId: q.branchId } : {},
            q.categoryId ? { categoryId: q.categoryId } : {},
            period ? { occurredOn: { gte: period.from, lte: period.to } } : {},
            cursor ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {},
          ],
        },
        include: { category: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map(expenseView),
        nextCursor: rows.length > limit ? encodeCursor({ at: page[page.length - 1].createdAt, id: page[page.length - 1].id }) : null,
      };
    });
  }

  get(access: EffectiveAccess, expenseId: string) {
    return this.db.inOrg(access, async (tx) => {
      const e = await tx.expense.findUnique({
        where: { id: expenseId },
        include: {
          category: { select: { id: true, name: true } },
          events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          attachments: {
            select: { id: true, fileName: true, contentType: true, sizeBytes: true, uploadedByUserId: true, createdAt: true, object: { select: { state: true } } },
            orderBy: { createdAt: 'asc' },
          },
          correctedBy: { select: { id: true, number: true, status: true } },
        },
      });
      if (!e || !this.mayRead(access, e)) throw Errors.notFound('Expense');
      return {
        ...expenseView(e),
        events: e.events.map((ev) => ({ type: ev.type, fromStatus: ev.fromStatus, toStatus: ev.toStatus, actorUserId: ev.actorUserId, reason: ev.reason, createdAt: ev.createdAt })),
        attachments: e.attachments.map(({ object, ...a }) => ({ ...a, scanStatus: object.state })),
        correctedBy: e.correctedBy,
      };
    });
  }

  // ---------------------------------------------------------------- expenses: writes

  async create(access: EffectiveAccess, dto: CreateExpenseDto, idempotencyKey: string | undefined, meta: RequestMeta) {
    const key = requireIdempotencyKey(idempotencyKey);
    const amount = positiveAmount(dto.amountMinor, 'amountMinor');
    const occurredOn = parseOccurredOn(dto.occurredOn);
    const reference = cleanReference(dto.reference);
    const description = dto.description.trim();
    if (!can(access, 'finance.expense.create', dto.branchId)) throw Errors.forbidden();
    const replay = async (tx: Tx) => {
      const e = await tx.expense.findUnique({
        where: { organizationId_idempotencyKey: { organizationId: access.organizationId, idempotencyKey: key } },
        include: { category: { select: { id: true, name: true } } },
      });
      if (!e) return null;
      const same = e.createdByUserId === access.userId && e.categoryId === dto.categoryId && e.amountMinor === amount && e.branchId === (dto.branchId ?? null)
        && fmtDate(e.occurredOn) === fmtDate(occurredOn) && e.description === description && (dto.currency === undefined || e.currency === dto.currency)
        && e.correctsExpenseId === (dto.correctsExpenseId ?? null);
      if (!same) throw idempotencyReused();
      return { replayed: true, expense: expenseView(e) };
    };
    return this.once(access, async (tx) => {
      const again = await replay(tx);
      if (again) return again;
      if (dto.branchId) await this.activeBranch(tx, dto.branchId);
      await this.activeCategory(tx, dto.categoryId);
      const org = await tx.organization.findUniqueOrThrow({ where: { id: access.organizationId }, select: { defaultCurrency: true } });
      if (dto.correctsExpenseId) {
        const voided = await tx.expense.findUnique({ where: { id: dto.correctsExpenseId }, select: { status: true, branchId: true, createdByUserId: true } });
        if (!voided || !this.mayRead(access, voided)) throw Errors.notFound('Expense');
        if (voided.status !== 'VOIDED') throw Errors.conflict('not_voided', 'Only a voided expense can be corrected');
      }
      const number = await this.nextNumber(tx, access, 'expense', 'E');
      const e = await tx.expense.create({
        data: {
          organizationId: access.organizationId, branchId: dto.branchId ?? null, categoryId: dto.categoryId, number, amountMinor: amount,
          currency: dto.currency ?? org.defaultCurrency, description, reference, occurredOn, createdByUserId: access.userId,
          correctsExpenseId: dto.correctsExpenseId ?? null, idempotencyKey: key,
        },
        include: { category: { select: { id: true, name: true } } },
      });
      await this.event(tx, access, e.id, 'created', null, 'DRAFT', null, dto.correctsExpenseId ? { correctsExpenseId: dto.correctsExpenseId } : {});
      await this.audit.record(tx, {
        action: 'finance.expense.created', resourceType: 'expense', resourceId: e.id, organizationId: access.organizationId, branchId: e.branchId,
        actorUserId: access.userId, metadata: { number, amountMinor: amount.toString(), currency: e.currency, categoryId: e.categoryId, correctsExpenseId: e.correctsExpenseId },
      }, meta);
      return { replayed: false, expense: expenseView(e) };
    }, replay);
  }

  update(access: EffectiveAccess, expenseId: string, dto: UpdateExpenseDto, meta: RequestMeta) {
    const amount = dto.amountMinor !== undefined ? positiveAmount(dto.amountMinor, 'amountMinor') : undefined;
    const occurredOn = dto.occurredOn !== undefined ? parseOccurredOn(dto.occurredOn) : undefined;
    const reference = dto.reference !== undefined ? cleanReference(dto.reference) : undefined;
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertWritable(tx, access.organizationId);
      const e = await this.lock(tx, access, expenseId);
      this.assertCreator(access, e, 'edited');
      if (e.status !== 'DRAFT') throw wrongStatus(e.status, 'edited');
      if (e.version !== dto.version) throw versionConflict(e.version);
      const branchId = dto.branchId === undefined ? e.branch_id : dto.branchId;
      if (!can(access, 'finance.expense.create', branchId ?? undefined)) throw Errors.forbidden();
      if (dto.branchId) await this.activeBranch(tx, dto.branchId);
      if (dto.categoryId) await this.activeCategory(tx, dto.categoryId);
      const data: Prisma.ExpenseUncheckedUpdateInput = {
        ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        ...(amount !== undefined ? { amountMinor: amount } : {}),
        ...(dto.currency ? { currency: dto.currency } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(reference !== undefined ? { reference } : {}),
        ...(occurredOn ? { occurredOn } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
      };
      const changed = Object.keys(data);
      if (!changed.length) throw Errors.badRequest('nothing_to_update', 'Send at least one field to change');
      const updated = await tx.expense.update({ where: { id: expenseId }, data, include: { category: { select: { id: true, name: true } } } });
      await this.event(tx, access, e.id, 'edited', 'DRAFT', 'DRAFT', null, { fields: changed });
      await this.audit.record(tx, {
        action: 'finance.expense.updated', resourceType: 'expense', resourceId: e.id, organizationId: access.organizationId, branchId: updated.branchId,
        actorUserId: access.userId, before: { amountMinor: e.amount_minor.toString(), currency: e.currency, branchId: e.branch_id },
        after: { amountMinor: updated.amountMinor.toString(), currency: updated.currency, branchId: updated.branchId }, metadata: { fields: changed },
      }, meta);
      return expenseView(updated);
    });
  }

  submit(access: EffectiveAccess, expenseId: string, dto: ExpenseVersionDto, meta: RequestMeta) {
    return this.transition(access, expenseId, dto.version, meta, 'submitted', 'SUBMITTED', ['DRAFT'], async (tx, e) => {
      this.assertCreator(access, e, 'submitted');
      if (!can(access, 'finance.expense.create', e.branch_id ?? undefined)) throw Errors.forbidden();
      const full = await tx.expense.findUniqueOrThrow({ where: { id: e.id }, select: { categoryId: true } });
      await this.activeCategory(tx, full.categoryId);
      return { submittedByUserId: access.userId, submittedAt: new Date() };
    });
  }

  approve(access: EffectiveAccess, expenseId: string, dto: ExpenseVersionDto, meta: RequestMeta) {
    return this.transition(access, expenseId, dto.version, meta, 'approved', 'APPROVED', ['SUBMITTED'], async (_tx, e) => {
      if (!can(access, 'finance.expense.approve')) throw Errors.forbidden();
      this.assertNotCreator(access, e, 'approve');
      return { decidedByUserId: access.userId, decidedAt: new Date() };
    });
  }

  reject(access: EffectiveAccess, expenseId: string, dto: ExpenseReasonDto, meta: RequestMeta) {
    const reason = dto.reason.trim();
    return this.transition(access, expenseId, dto.version, meta, 'rejected', 'REJECTED', ['SUBMITTED'], async (_tx, e) => {
      if (!can(access, 'finance.expense.approve')) throw Errors.forbidden();
      this.assertNotCreator(access, e, 'reject');
      return { decidedByUserId: access.userId, decidedAt: new Date(), rejectionReason: reason };
    }, reason);
  }

  cancel(access: EffectiveAccess, expenseId: string, dto: CancelExpenseDto, meta: RequestMeta) {
    const reason = dto.reason?.trim() || null;
    return this.transition(access, expenseId, dto.version, meta, 'cancelled', 'CANCELLED', ['DRAFT', 'SUBMITTED'], async (_tx, e) => {
      const ownDraft = e.created_by_user_id === access.userId && can(access, 'finance.expense.create', e.branch_id ?? undefined);
      if (!ownDraft && !can(access, 'finance.expense.approve')) throw Errors.forbidden();
      return { cancelledByUserId: access.userId, cancelledAt: new Date(), cancelReason: reason };
    }, reason);
  }

  void(access: EffectiveAccess, expenseId: string, dto: ExpenseReasonDto, meta: RequestMeta) {
    const reason = dto.reason.trim();
    return this.transition(access, expenseId, dto.version, meta, 'voided', 'VOIDED', ['APPROVED'], async (_tx, e) => {
      if (!can(access, 'finance.expense.void')) throw Errors.forbidden();
      this.assertNotCreator(access, e, 'void');
      return { voidedByUserId: access.userId, voidedAt: new Date(), voidReason: reason };
    }, reason);
  }

  // ---------------------------------------------------------------- attachments

  async uploadAttachment(access: EffectiveAccess, expenseId: string, data: Buffer, declaredType: string | undefined, rawName: string | undefined, meta: RequestMeta) {
    // Authorize before looking at or storing the bytes: a caller who may not see the expense learns nothing.
    const target = await this.db.inOrg(access, async (tx) => {
      const e = await tx.expense.findUnique({ where: { id: expenseId }, select: { id: true, status: true, branchId: true, createdByUserId: true } });
      if (!e || !this.mayRead(access, e)) throw Errors.notFound('Expense');
      if (e.createdByUserId !== access.userId || !can(access, 'finance.expense.create', e.branchId ?? undefined)) throw Errors.forbidden('Only the expense creator can attach files');
      if (e.status !== 'DRAFT' && e.status !== 'SUBMITTED') throw wrongStatus(e.status, 'given attachments');
      return e;
    });
    let contentType: string;
    try {
      contentType = validateAttachment(data, declaredType);
    } catch (e) {
      if (!(e instanceof AttachmentRejected)) throw e;
      const status = e.code === 'attachment_too_large' ? HttpStatus.PAYLOAD_TOO_LARGE : e.code === 'attachment_empty' ? HttpStatus.BAD_REQUEST : HttpStatus.UNSUPPORTED_MEDIA_TYPE;
      throw new ApiError(status, e.code, e.message);
    }
    const id = randomUUID();
    // Server-generated key only: nothing from the client reaches the storage path.
    const storageKey = `finance/${target.id}/${id}`;
    const fileName = sanitizeFileName(rawName);
    const sha256 = createHash('sha256').update(data).digest('hex');
    // The object row (UPLOADING) commits with the attachment row before any bytes are written,
    // so an interrupted upload is always found and cleaned up (docs/security/attachments.md §3).
    const row = await this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertWritable(tx, access.organizationId);
      // Serializes with transitions and with other uploads (the count limit holds under concurrency).
      const e = await this.lock(tx, access, expenseId);
      if (e.status !== 'DRAFT' && e.status !== 'SUBMITTED') throw wrongStatus(e.status, 'given attachments');
      // Abandoned and blocked uploads do not count: the creator may replace them.
      const live = await tx.expenseAttachment.count({ where: { expenseId, object: { state: { notIn: ['ABANDONED', 'INFECTED'] } } } });
      if (live >= MAX_ATTACHMENTS_PER_EXPENSE) throw Errors.conflict('too_many_attachments', `An expense may have at most ${MAX_ATTACHMENTS_PER_EXPENSE} attachments`);
      await this.objects.register(tx, { id, domain: 'finance', storageKey, contentType, data, sha256 });
      const created = await tx.expenseAttachment.create({
        data: { id, organizationId: access.organizationId, expenseId, storageKey, fileName, contentType, sizeBytes: data.length, sha256, uploadedByUserId: access.userId },
        select: { id: true, fileName: true, contentType: true, sizeBytes: true, uploadedByUserId: true, createdAt: true },
      });
      await this.event(tx, access, expenseId, 'attachment_added', null, null, null, { attachmentId: id, contentType, sizeBytes: data.length });
      await this.audit.record(tx, {
        action: 'finance.expense.attachment.uploaded', resourceType: 'expense_attachment', resourceId: id, organizationId: access.organizationId,
        branchId: e.branch_id, actorUserId: access.userId, metadata: { expenseId, contentType, sizeBytes: data.length },
      }, meta);
      return created;
    });
    const scanStatus = await this.objects.storeAndScan(id, storageKey, data, sha256);
    return { ...row, scanStatus };
  }

  async downloadAttachment(access: EffectiveAccess, attachmentId: string, meta: RequestMeta) {
    const a = await this.db.inOrg(access, async (tx) => {
      const row = await tx.expenseAttachment.findUnique({
        where: { id: attachmentId },
        include: {
          expense: { select: { id: true, branchId: true, createdByUserId: true } },
          object: { select: { id: true, state: true, backend: true, storageKey: true, sha256: true, sizeBytes: true } },
        },
      });
      if (!row || !this.mayRead(access, row.expense)) throw Errors.notFound('Attachment');
      return row;
    });
    // Served only when scanned CLEAN, and only if the bytes still match the recorded SHA-256.
    const data = await this.objects.readVerified(a.object);
    await this.db.inOrg(access, (tx) => this.audit.record(tx, {
      action: 'finance.expense.attachment.downloaded', resourceType: 'expense_attachment', resourceId: a.id, organizationId: access.organizationId,
      branchId: a.expense.branchId, actorUserId: access.userId, metadata: { expenseId: a.expenseId },
    }, meta));
    return { fileName: a.fileName, contentType: a.contentType, data };
  }

  // ---------------------------------------------------------------- internals

  /** Expenses the caller may read: their own, any at branches where they hold finance.expense.read, everything for approvers. */
  private readScope(access: EffectiveAccess): 'ALL' | string[] {
    if (can(access, 'finance.expense.approve') || can(access, 'finance.expense.void')) return 'ALL';
    return branchesWith(access, 'finance.expense.read');
  }

  private mayRead(access: EffectiveAccess, e: { createdByUserId: string; branchId: string | null }): boolean {
    if (e.createdByUserId === access.userId) return true;
    const scope = this.readScope(access);
    // Organization-level expenses (no branch) need organization-wide read.
    return scope === 'ALL' || (e.branchId !== null && scope.includes(e.branchId));
  }

  private anyFinanceRole(access: EffectiveAccess): boolean {
    return ['finance.expense.create', 'finance.expense.read', 'finance.expense.approve', 'finance.expense.void', 'finance.category.manage', 'finance.report.read']
      .some((k) => branchesWith(access, k) === 'ALL' || (branchesWith(access, k) as string[]).length > 0);
  }

  private assertCreator(access: EffectiveAccess, e: Locked, action: string) {
    if (e.created_by_user_id !== access.userId) throw Errors.forbidden(`Only the expense creator can have it ${action}`);
  }

  private assertNotCreator(access: EffectiveAccess, e: Locked, action: string) {
    if (e.created_by_user_id === access.userId) throw Errors.forbidden(`You cannot ${action} your own expense`);
  }

  /** Locks the expense row; 404 unless the caller may see it. */
  private async lock(tx: Tx, access: EffectiveAccess, id: string): Promise<Locked> {
    const [e] = await tx.$queryRaw<Locked[]>`
      SELECT id, status::text AS status, version, branch_id, created_by_user_id, number, currency, amount_minor
      FROM expenses WHERE id = ${id}::uuid FOR UPDATE`;
    if (!e || !this.mayRead(access, { createdByUserId: e.created_by_user_id, branchId: e.branch_id })) throw Errors.notFound('Expense');
    return e;
  }

  private transition(
    access: EffectiveAccess, id: string, version: number, meta: RequestMeta, verb: string, to: Status, from: Status[],
    authorize: (tx: Tx, e: Locked) => Promise<Prisma.ExpenseUncheckedUpdateInput>, reason: string | null = null,
  ) {
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertWritable(tx, access.organizationId);
      const e = await this.lock(tx, access, id);
      const fields = await authorize(tx, e);
      if (!from.includes(e.status)) throw wrongStatus(e.status, verb);
      if (e.version !== version) throw versionConflict(e.version);
      const updated = await tx.expense.update({ where: { id }, data: { ...fields, status: to }, include: { category: { select: { id: true, name: true } } } });
      await this.event(tx, access, id, verb, e.status, to, reason, {});
      await this.audit.record(tx, {
        action: `finance.expense.${verb}`, resourceType: 'expense', resourceId: id, organizationId: access.organizationId, branchId: e.branch_id,
        actorUserId: access.userId, before: { status: e.status }, after: { status: to },
        metadata: { number: e.number, amountMinor: e.amount_minor.toString(), currency: e.currency, ...(reason ? { reason } : {}) },
      }, meta);
      return expenseView(updated);
    });
  }

  private async activeBranch(tx: Tx, branchId: string) {
    const b = await tx.branch.findUnique({ where: { id: branchId }, select: { status: true } });
    if (!b) throw Errors.notFound('Branch');
    if (b.status !== 'ACTIVE') throw Errors.conflict('branch_archived', 'This branch is archived and accepts no new transactions');
  }

  private async activeCategory(tx: Tx, categoryId: string) {
    const c = await tx.expenseCategory.findUnique({ where: { id: categoryId }, select: { status: true } });
    if (!c) throw Errors.notFound('Expense category');
    if (c.status !== 'ACTIVE') throw Errors.conflict('category_archived', 'This expense category is archived');
  }

  private async nextNumber(tx: Tx, access: EffectiveAccess, name: string, prefix: string): Promise<string> {
    const [seq] = await tx.$queryRaw<{ last_value: bigint }[]>`
      INSERT INTO organization_sequences (organization_id, name, last_value) VALUES (${access.organizationId}::uuid, ${name}, 1)
      ON CONFLICT (organization_id, name) DO UPDATE SET last_value = organization_sequences.last_value + 1
      RETURNING last_value`;
    return `${prefix}-${seq.last_value.toString().padStart(6, '0')}`;
  }

  private event(tx: Tx, access: EffectiveAccess, expenseId: string, type: string, from: string | null, to: string | null, reason: string | null, data: Record<string, unknown>) {
    return tx.expenseEvent.createMany({
      data: [{ organizationId: access.organizationId, expenseId, type, fromStatus: from, toStatus: to, actorUserId: access.userId, reason, data: data as Prisma.InputJsonValue }],
    });
  }

  /** Runs a posting once per Idempotency-Key: a concurrent duplicate replays the winner. */
  private async once<T>(access: EffectiveAccess, post: (tx: Tx) => Promise<T>, replay: (tx: Tx) => Promise<T | null>): Promise<T> {
    try {
      return await this.db.inOrg(access, async (tx) => {
        await this.entitlements.assertWritable(tx, access.organizationId);
        return post(tx);
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      const again = await this.db.inOrg(access, (tx) => replay(tx));
      if (again) return again;
      if (/corrects_expense_id|expenses_one_live_correction/.test(`${e.message} ${JSON.stringify(e.meta ?? {})}`)) {
        throw Errors.conflict('already_corrected', 'This voided expense already has a correction');
      }
      throw Errors.conflict('already_posted', 'This operation was already posted');
    }
  }
}

function categoryNameTaken(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return Errors.conflict('category_name_taken', 'An expense category with this name already exists');
  return e;
}

function categoryView(c: { id: string; name: string; description: string | null; status: string; version: number; createdAt: Date; updatedAt: Date }) {
  return { id: c.id, name: c.name, description: c.description, status: c.status, version: c.version, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

export function expenseView(e: ExpenseRow) {
  return {
    id: e.id, number: e.number, status: e.status, branchId: e.branchId, category: e.category, amountMinor: fmtMinor(e.amountMinor), currency: e.currency,
    description: e.description, reference: e.reference, occurredOn: fmtDate(e.occurredOn), createdByUserId: e.createdByUserId,
    submittedByUserId: e.submittedByUserId, submittedAt: e.submittedAt, decidedByUserId: e.decidedByUserId, decidedAt: e.decidedAt,
    rejectionReason: e.rejectionReason, cancelledByUserId: e.cancelledByUserId, cancelledAt: e.cancelledAt, cancelReason: e.cancelReason,
    voidedByUserId: e.voidedByUserId, voidedAt: e.voidedAt, voidReason: e.voidReason, correctsExpenseId: e.correctsExpenseId,
    version: e.version, createdAt: e.createdAt, updatedAt: e.updatedAt,
  };
}
