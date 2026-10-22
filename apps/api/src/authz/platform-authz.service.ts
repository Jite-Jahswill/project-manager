import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface PlatformAccess {
  userId: string;
  permissions: ReadonlySet<string>;
}

/** Loads platform-administration permissions. Independent of any organization membership. */
@Injectable()
export class PlatformAuthzService {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string): Promise<PlatformAccess | null> {
    const admin = await this.prisma.platformAdmin.findFirst({
      where: { userId, status: 'ACTIVE' },
      select: { roles: { select: { role: { select: { permissions: { select: { permissionKey: true } } } } } } },
    });
    if (!admin) return null;
    return {
      userId,
      permissions: new Set(admin.roles.flatMap((r) => r.role.permissions.map((p) => p.permissionKey))),
    };
  }
}
