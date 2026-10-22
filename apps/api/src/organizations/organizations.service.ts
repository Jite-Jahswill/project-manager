import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb } from '../database/tenant-db.service';
import { EffectiveAccess, effectivePermissionKeys } from '../authz/permission-evaluator';
import { OWNER_TEMPLATE_KEY, ROLE_TEMPLATES } from '../authz/role-templates';
import { EntitlementService } from '../subscriptions/entitlement.service';
import { DEFAULT_PLAN_CODE, ENTITLEMENTS, TRIAL_DAYS } from '../subscriptions/entitlements';
import { PrismaService } from '../database/prisma.service';
import type { CreateBranchDto, CreateOrganizationDto } from './dto/organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
  ) {}

  /**
   * Creates an organization with the caller as Owner, the starter role
   * templates, a main branch and a trial subscription, atomically.
   * The ID is generated here so tenant context can be set before the first insert;
   * no RLS bypass is needed.
   */
  async create(userId: string, dto: CreateOrganizationDto, meta: RequestMeta) {
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
        const role = await tx.role.create({ data: { organizationId: orgId, name: t.name, description: t.description, templateKey: t.key } });
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
      return org;
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
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: access.organizationId },
        select: { id: true, name: true, slug: true, defaultCurrency: true, status: true, createdAt: true },
      });
      return { ...org, membershipId: access.membershipId, isOwner: access.isOwner, permissions: effectivePermissionKeys(access) };
    });
  }

  subscription(access: EffectiveAccess) {
    return this.db.inOrg(access, (tx) => this.entitlements.usage(tx, access.organizationId));
  }

  listBranches(access: EffectiveAccess) {
    return this.db.inOrg(access, (tx) =>
      tx.branch.findMany({ select: { id: true, name: true, code: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    );
  }

  createBranch(access: EffectiveAccess, dto: CreateBranchDto, meta: RequestMeta) {
    return this.db.inOrg(access, async (tx) => {
      await this.entitlements.assertBelowLimit(tx, access.organizationId, ENTITLEMENTS.branches, () =>
        tx.branch.count({ where: { status: 'ACTIVE' } }),
      );
      const existing = await tx.branch.findFirst({ where: { code: dto.code }, select: { id: true } });
      if (existing) throw Errors.conflict('branch_code_taken', 'A branch with this code already exists');
      const branch = await tx.branch.create({ data: { organizationId: access.organizationId, name: dto.name.trim(), code: dto.code } });
      await this.audit.record(tx, {
        action: 'organization.branch.created', resourceType: 'branch', resourceId: branch.id,
        organizationId: access.organizationId, branchId: branch.id, actorUserId: access.userId, after: { name: branch.name, code: branch.code },
      }, meta);
      return branch;
    });
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
