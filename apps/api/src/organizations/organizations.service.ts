import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { EffectiveAccess, effectivePermissionKeys } from '../authz/permission-evaluator';
import { ROLE_TEMPLATE_VERSION } from '../authz/role-template-history';
import { OWNER_TEMPLATE_KEY, ROLE_TEMPLATES } from '../authz/role-templates';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { DEFAULT_PLAN_CODE, ENTITLEMENTS, TRIAL_DAYS } from '../subscriptions/entitlements';
import { PrismaService } from '../database/prisma.service';
import { OrgAuthzService } from '../authz/org-authz.service';
import { Prisma } from '../generated/prisma/client';
import type { CreateBranchDto, CreateOrganizationDto, UpdateBranchDto, UpdateOrganizationDto } from './dto/organization.dto';

const ORG_SELECT = { id: true, name: true, slug: true, defaultCurrency: true, status: true, version: true, createdAt: true } as const;
const BRANCH_SELECT = { id: true, name: true, code: true, status: true, version: true, createdAt: true, updatedAt: true, archivedAt: true } as const;

const versionConflict = (current: number) =>
  Errors.conflict('version_conflict', `The record changed (current version ${current}); reload and retry`);

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
    private readonly authz: OrgAuthzService,
  ) {}

  /**
   * Creates an organization with the caller as Owner, the starter role
   * templates, a main branch and a trial subscription, atomically.
   * The ID is generated here so tenant context can be set before the first insert;
   * no RLS bypass is needed.
   *
   * Duplicate-safe: the slug is unique, so concurrent creations of the same slug produce
   * exactly one organization. A retry of the SAME request (same user, slug and name) returns
   * that organization with `created: false`; anyone else gets 409 slug_taken (which reveals
   * only that the address is in use, as any public identifier must).
   */
  async create(userId: string, dto: CreateOrganizationDto, meta: RequestMeta) {
    const replay = await this.findOwnReplay(userId, dto);
    if (replay) return { ...replay, created: false };
    try {
      return { ...(await this.createNew(userId, dto, meta)), created: true };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
      const raced = await this.findOwnReplay(userId, dto);
      if (raced) return { ...raced, created: false };
      throw Errors.conflict('slug_taken', 'This organization address is already taken; choose another');
    }
  }

  /** The caller's own organization with this slug and name, if they created it and still belong to it. */
  private async findOwnReplay(userId: string, dto: CreateOrganizationDto) {
    const m = await this.db.asUser(userId, (tx) => tx.organizationMembership.findFirst({
      where: { userId, status: 'ACTIVE', organization: { slug: dto.slug, createdByUserId: userId, name: dto.name.trim() } },
      select: { id: true, organization: { select: ORG_SELECT } },
    }));
    return m ? { ...m.organization, membershipId: m.id } : null;
  }

  private async createNew(userId: string, dto: CreateOrganizationDto, meta: RequestMeta) {
    const plan = await this.prisma.plan.findUnique({ where: { code: DEFAULT_PLAN_CODE } });
    if (!plan) throw new Error(`Default plan ${DEFAULT_PLAN_CODE} missing: run db:seed`);
    const orgId = randomUUID();
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 86_400_000);

    return this.db.inOrgUnchecked(orgId, userId, async (tx) => {
      const org = await tx.organization.create({
        data: { id: orgId, name: dto.name.trim(), slug: dto.slug, defaultCurrency: dto.defaultCurrency ?? 'USD', createdByUserId: userId },
      });
      const membership = await tx.organizationMembership.create({ data: { organizationId: orgId, userId } });
      const ownerRole = await tx.role.create({
        data: { organizationId: orgId, name: 'Owner', description: 'Full control, including ownership transfer.', isSystem: true, templateKey: OWNER_TEMPLATE_KEY },
      });
      for (const t of ROLE_TEMPLATES) {
        const role = await tx.role.create({
          data: { organizationId: orgId, name: t.name, description: t.description, templateKey: t.key, templateVersion: ROLE_TEMPLATE_VERSION },
        });
        await tx.rolePermission.createMany({
          data: t.permissions.map((permissionKey) => ({ organizationId: orgId, roleId: role.id, permissionKey })),
        });
      }
      await tx.membershipRole.create({
        data: { organizationId: orgId, membershipId: membership.id, roleId: ownerRole.id, assignedByUserId: userId },
      });
      await tx.branch.create({ data: { organizationId: orgId, name: 'Main branch', code: 'MAIN' } });
      await tx.organizationSubscription.create({
        data: {
          organizationId: orgId, planId: plan.id, status: 'TRIALING',
          currentPeriodStart: now, currentPeriodEnd: trialEndsAt, trialEndsAt,
        },
      });
      await this.audit.record(tx, {
        action: 'organization.created', resourceType: 'organization', resourceId: orgId, organizationId: orgId,
        actorUserId: userId, after: { name: org.name, slug: org.slug, plan: plan.code },
      }, meta);
      return {
        id: org.id, name: org.name, slug: org.slug, defaultCurrency: org.defaultCurrency, status: org.status, version: org.version,
        createdAt: org.createdAt, membershipId: membership.id,
      };
    });
  }

  /** Profile update (name, default currency). The slug is the stable public identifier and does not change. */
  update(access: EffectiveAccess, dto: UpdateOrganizationDto, meta: RequestMeta) {
    if (dto.name === undefined && dto.defaultCurrency === undefined) throw Errors.badRequest('nothing_to_update', 'Provide name or defaultCurrency');
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.authz.lockAndReload(tx, access, 'organization.settings.manage');
      const before = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId }, select: ORG_SELECT });
      if (before.version !== dto.version) throw versionConflict(before.version);
      const after = await tx.organization.update({
        where: { id: actor.organizationId },
        data: { ...(dto.name ? { name: dto.name.trim() } : {}), ...(dto.defaultCurrency ? { defaultCurrency: dto.defaultCurrency } : {}), version: { increment: 1 } },
        select: ORG_SELECT,
      });
      await this.audit.record(tx, {
        action: 'organization.updated', resourceType: 'organization', resourceId: actor.organizationId, organizationId: actor.organizationId,
        actorUserId: actor.userId, before: { name: before.name, defaultCurrency: before.defaultCurrency }, after: { name: after.name, defaultCurrency: after.defaultCurrency },
      }, meta);
      return after;
    });
  }

  /** Organizations the user actively belongs to (the org switcher). */
  listForUser(userId: string) {
    return this.db.asUser(userId, (tx) =>
      tx.organizationMembership.findMany({
        where: { userId, status: 'ACTIVE', organization: { status: 'ACTIVE' } },
        select: { id: true, organization: { select: { id: true, name: true, slug: true, defaultCurrency: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ).then((rows) => rows.map((r) => ({ ...r.organization, membershipId: r.id })));
  }

  get(access: EffectiveAccess) {
    return this.db.inOrg(access, async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: access.organizationId }, select: ORG_SELECT });
      return { ...org, membershipId: access.membershipId, isOwner: access.isOwner, permissions: effectivePermissionKeys(access) };
    });
  }

  subscription(access: EffectiveAccess) {
    return this.db.inOrg(access, (tx) => this.entitlements.usage(tx, access.organizationId));
  }

  listBranches(access: EffectiveAccess, status?: 'ACTIVE' | 'ARCHIVED') {
    return this.db.inOrg(access, (tx) =>
      tx.branch.findMany({ where: status ? { status } : {}, select: BRANCH_SELECT, orderBy: { createdAt: 'asc' } }),
    );
  }

  /** RLS scopes the lookup to this organization: another organization's branch ID is simply not found. */
  getBranch(access: EffectiveAccess, branchId: string) {
    return this.db.inOrg(access, async (tx) => {
      const branch = await tx.branch.findUnique({ where: { id: branchId }, select: BRANCH_SELECT });
      if (!branch) throw Errors.notFound('Branch');
      return branch;
    });
  }

  createBranch(access: EffectiveAccess, dto: CreateBranchDto, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      // Locked: concurrent creations cannot both pass the plan limit.
      const actor = await this.authz.lockAndReload(tx, access, 'organization.branch.manage');
      await this.entitlements.assertBelowLimit(tx, actor.organizationId, ENTITLEMENTS.branches, () =>
        tx.branch.count({ where: { status: 'ACTIVE' } }),
      );
      await this.assertCodeFree(tx, dto.code);
      const branch = await tx.branch.create({ data: { organizationId: actor.organizationId, name: dto.name.trim(), code: dto.code }, select: BRANCH_SELECT });
      await this.audit.record(tx, {
        action: 'organization.branch.created', resourceType: 'branch', resourceId: branch.id,
        organizationId: actor.organizationId, branchId: branch.id, actorUserId: actor.userId, after: { name: branch.name, code: branch.code },
      }, meta);
      return branch;
    });
  }

  updateBranch(access: EffectiveAccess, branchId: string, dto: UpdateBranchDto, meta: RequestMeta) {
    if (dto.name === undefined && dto.code === undefined) throw Errors.badRequest('nothing_to_update', 'Provide name or code');
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.authz.lockAndReload(tx, access, 'organization.branch.manage');
      const before = await this.loadBranchForChange(tx, branchId, dto.version);
      if (before.status === 'ARCHIVED') throw Errors.conflict('branch_archived', 'Reactivate the branch before editing it');
      if (dto.code && dto.code !== before.code) await this.assertCodeFree(tx, dto.code);
      const after = await tx.branch.update({
        where: { id: branchId },
        data: { ...(dto.name ? { name: dto.name.trim() } : {}), ...(dto.code ? { code: dto.code } : {}), version: { increment: 1 } },
        select: BRANCH_SELECT,
      });
      await this.audit.record(tx, {
        action: 'organization.branch.updated', resourceType: 'branch', resourceId: branchId, organizationId: actor.organizationId,
        branchId, actorUserId: actor.userId, before: { name: before.name, code: before.code }, after: { name: after.name, code: after.code },
      }, meta);
      return after;
    });
  }

  /**
   * Archives a branch. Nothing is deleted: stock balances and movements, role assignments and
   * audit history stay. Archived branches accept no new business writes, branch-limited roles
   * there grant nothing, and open invitations scoped to the branch are revoked.
   * The last active branch cannot be archived.
   */
  archiveBranch(access: EffectiveAccess, branchId: string, version: number, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.authz.lockAndReload(tx, access, 'organization.branch.manage');
      const before = await this.loadBranchForChange(tx, branchId, version);
      if (before.status === 'ARCHIVED') throw Errors.conflict('branch_archived', 'The branch is already archived');
      if ((await tx.branch.count({ where: { status: 'ACTIVE' } })) <= 1) {
        throw Errors.conflict('last_active_branch', 'An organization must keep at least one active branch');
      }
      const revoked = await tx.organizationInvitation.updateMany({
        where: { branchId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() },
      });
      const after = await tx.branch.update({
        where: { id: branchId }, data: { status: 'ARCHIVED', archivedAt: new Date(), version: { increment: 1 } }, select: BRANCH_SELECT,
      });
      await this.audit.record(tx, {
        action: 'organization.branch.archived', resourceType: 'branch', resourceId: branchId, organizationId: actor.organizationId,
        branchId, actorUserId: actor.userId, before: { status: before.status }, after: { status: after.status },
        metadata: { revokedInvitations: revoked.count },
      }, meta);
      return { ...after, revokedInvitations: revoked.count };
    });
  }

  reactivateBranch(access: EffectiveAccess, branchId: string, version: number, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      const actor = await this.authz.lockAndReload(tx, access, 'organization.branch.manage');
      const before = await this.loadBranchForChange(tx, branchId, version);
      if (before.status === 'ACTIVE') throw Errors.conflict('branch_active', 'The branch is already active');
      await this.entitlements.assertBelowLimit(tx, actor.organizationId, ENTITLEMENTS.branches, () => tx.branch.count({ where: { status: 'ACTIVE' } }));
      const after = await tx.branch.update({
        where: { id: branchId }, data: { status: 'ACTIVE', archivedAt: null, version: { increment: 1 } }, select: BRANCH_SELECT,
      });
      await this.audit.record(tx, {
        action: 'organization.branch.reactivated', resourceType: 'branch', resourceId: branchId, organizationId: actor.organizationId,
        branchId, actorUserId: actor.userId, before: { status: before.status }, after: { status: after.status },
      }, meta);
      return after;
    });
  }

  private async loadBranchForChange(tx: Tx, branchId: string, version: number) {
    const branch = await tx.branch.findUnique({ where: { id: branchId }, select: BRANCH_SELECT });
    if (!branch) throw Errors.notFound('Branch');
    if (branch.version !== version) throw versionConflict(branch.version);
    return branch;
  }

  private async assertCodeFree(tx: Tx, code: string): Promise<void> {
    const existing = await tx.branch.findFirst({ where: { code }, select: { id: true } });
    if (existing) throw Errors.conflict('branch_code_taken', 'A branch with this code already exists');
  }

  listAuditEvents(access: EffectiveAccess, limit = 50, before?: string) {
    return this.db.inOrg(access, (tx) =>
      tx.auditEvent.findMany({
        where: { organizationId: access.organizationId, ...(before ? { occurredAt: { lt: new Date(before) } } : {}) },
        orderBy: { occurredAt: 'desc' },
        take: limit,
      }),
    );
  }
}
