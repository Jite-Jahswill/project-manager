import type { PrismaClient } from '../generated/prisma/client';
import { normalizeEmail } from '../common/crypto';
import { SUPER_ADMIN_ROLE_NAME } from '../authz/platform-permission-registry';

/**
 * Grants the platform Super administrator role to an existing, verified user.
 *
 * Only works while no active super administrator exists. There is no HTTP
 * endpoint for this and no default credentials: it requires shell access to the
 * deployment and its database credentials. Additional administrators are then
 * granted through platform.admin.manage.
 */
export async function bootstrapSuperAdmin(prisma: PrismaClient, rawEmail: string): Promise<{ userId: string }> {
  const email = normalizeEmail(rawEmail);
  return prisma.$transaction(async (tx) => {
    // Platform RBAC tables are writable only in platform scope (RLS).
    await tx.$queryRaw`SELECT set_config('app.platform_scope', 'on', true)`;
    const role = await tx.platformRole.findUnique({ where: { name: SUPER_ADMIN_ROLE_NAME } });
    if (!role) throw new Error('Platform roles are not seeded: run `pnpm api db:seed` first');
    // Serialize concurrent bootstrap attempts.
    await tx.$queryRaw`SELECT id FROM platform_roles WHERE id = ${role.id}::uuid FOR UPDATE`;

    const existing = await tx.platformAdminRole.count({ where: { roleId: role.id, admin: { status: 'ACTIVE' } } });
    if (existing > 0) throw new Error('A super administrator already exists; bootstrap is disabled');

    const user = await tx.user.findUnique({ where: { email }, select: { id: true, emailVerifiedAt: true, status: true } });
    if (!user) throw new Error(`No user with email ${email}. Register through the app first.`);
    if (!user.emailVerifiedAt || user.status !== 'ACTIVE') throw new Error('The user must be active with a verified email');

    await tx.platformAdmin.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: { status: 'ACTIVE' } });
    await tx.platformAdminRole.create({ data: { adminUserId: user.id, roleId: role.id } });
    await tx.auditEvent.createMany({
      data: [{
        actorType: 'SYSTEM', action: 'platform.super_admin.bootstrapped', resourceType: 'platform_admin',
        resourceId: user.id, metadata: { via: 'cli' },
      }],
    });
    return { userId: user.id };
  });
}
