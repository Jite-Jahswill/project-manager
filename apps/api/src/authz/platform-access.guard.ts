import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Errors } from '../common/errors';
import type { VentidocRequest } from '../common/request-context';
import { PLATFORM_PERMISSIONS, PlatformPermissionKey } from './platform-permission-registry';
import { PlatformAuthzService } from './platform-authz.service';
import { RateLimiter } from '../abuse/rate-limiter.service';

export const PLATFORM_PERMISSION = 'ventidoc:platformPermission';
/** Privileged platform actions require a password re-entry within this window. */
export const STEP_UP_WINDOW_MS = 10 * 60_000;

@Injectable()
export class PlatformAccessGuard implements CanActivate {
  constructor(
    private readonly authz: PlatformAuthzService,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const keys = platformPermissionsOf(context.getHandler());
    if (!keys.length) throw new Error('PlatformAccessGuard used without @RequirePlatformPermission');
    const req = context.switchToHttp().getRequest<VentidocRequest>();
    if (!req.auth) throw Errors.unauthenticated();

    const access = await this.authz.load(req.auth.userId);
    const held = keys.filter((k) => access?.permissions.has(k));
    if (!held.length) throw Errors.forbidden();
    // Every platform permission requires an MFA-verified session.
    if (!req.auth.mfaVerifiedAt) throw Errors.mfaRequired();

    // Step-up applies when every permission that grants this route is privileged.
    if (held.every((k) => PLATFORM_PERMISSIONS.get(k)?.privileged)) {
      const at = req.auth.reauthenticatedAt;
      if (!at || Date.now() - at.getTime() > STEP_UP_WINDOW_MS) throw Errors.stepUpRequired();
      // Bounds the blast radius of a compromised administrator session. Fails closed.
      await this.limiter.enforce('platform.privileged.user', `user:${req.auth.userId}`);
    }
    return true;
  }
}

export function RequirePlatformPermission(key: PlatformPermissionKey) {
  return applyDecorators(SetMetadata(PLATFORM_PERMISSION, key), UseGuards(PlatformAccessGuard));
}

/**
 * Route open to holders of ANY of `keys` (e.g. inbox staff or the assigned agent). The
 * service must still apply the finer rule (which rows) on every request.
 */
export function RequireAnyPlatformPermission(...keys: [PlatformPermissionKey, ...PlatformPermissionKey[]]) {
  return applyDecorators(SetMetadata(PLATFORM_PERMISSION, keys), UseGuards(PlatformAccessGuard));
}

/** The permission keys that grant a handler (one for RequirePlatformPermission, several for the any-of form). */
export function platformPermissionsOf(handler: object): string[] {
  const meta = Reflect.getMetadata(PLATFORM_PERMISSION, handler) as string | string[] | undefined;
  return meta === undefined ? [] : Array.isArray(meta) ? meta : [meta];
}
