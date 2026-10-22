import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from '../common/errors';
import type { VentidocRequest } from '../common/request-context';
import { PLATFORM_PERMISSIONS, PlatformPermissionKey } from './platform-permission-registry';
import { PlatformAuthzService } from './platform-authz.service';

export const PLATFORM_PERMISSION = 'ventidoc:platformPermission';
/** Privileged platform actions require a password re-entry within this window. */
export const STEP_UP_WINDOW_MS = 10 * 60_000;

@Injectable()
export class PlatformAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authz: PlatformAuthzService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.get<PlatformPermissionKey | undefined>(PLATFORM_PERMISSION, context.getHandler());
    if (!key) throw new Error('PlatformAccessGuard used without @RequirePlatformPermission');
    const req = context.switchToHttp().getRequest<VentidocRequest>();
    if (!req.auth) throw Errors.unauthenticated();

    const access = await this.authz.load(req.auth.userId);
    if (!access || !access.permissions.has(key)) throw Errors.forbidden();

    if (PLATFORM_PERMISSIONS.get(key)?.privileged) {
      const at = req.auth.reauthenticatedAt;
      if (!at || Date.now() - at.getTime() > STEP_UP_WINDOW_MS) throw Errors.stepUpRequired();
    }
    return true;
  }
}

export function RequirePlatformPermission(key: PlatformPermissionKey) {
  return applyDecorators(SetMetadata(PLATFORM_PERMISSION, key), UseGuards(PlatformAccessGuard));
}
