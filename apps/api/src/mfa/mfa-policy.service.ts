import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TenantDb } from '../database/tenant-db.service';

/**
 * Who MUST use MFA (docs/security/mfa.md §2):
 *  - every ACTIVE platform administrator (platform RBAC; checked on platform_admins)
 *  - every ACTIVE owner of an ACTIVE organization (organization RBAC; checked by the
 *    database helper app_current_user_owns_any_org(), which answers only a boolean
 *    about the context user)
 * The two RBAC systems are queried separately; neither is derived from the other.
 * Evaluated on every request for sessions without a verified second factor, so a
 * role granted mid-session takes effect immediately.
 */
@Injectable()
export class MfaPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly db: TenantDb,
  ) {}

  async requiresMfa(userId: string): Promise<boolean> {
    const admin = await this.prisma.platformAdmin.findFirst({ where: { userId, status: 'ACTIVE' }, select: { userId: true } });
    if (admin) return true;
    const [row] = await this.db.asUser(userId, (tx) => tx.$queryRaw<{ owns: boolean }[]>`SELECT app_current_user_owns_any_org() AS owns`);
    return row.owns;
  }
}
