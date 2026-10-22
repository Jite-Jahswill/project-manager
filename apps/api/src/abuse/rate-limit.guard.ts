import { CanActivate, ExecutionContext, Inject, Injectable, UseGuards } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { normalizeEmail } from '../common/crypto';
import type { VentidocRequest } from '../common/request-context';
import { rateLimitNetwork } from './client-ip';
import { PolicyName } from './policies';
import { RateLimiter } from './rate-limiter.service';

/**
 * What a route-level limit is keyed on.
 *   ip         - the client network (IPv4 address / IPv6 prefix), from the trusted-proxy resolver
 *   email      - the normalized `email` field of the request body (anti mail-bombing).
 *                Unknown and registered addresses are limited identically.
 *   user       - the authenticated user (req.auth, set by the global AuthGuard)
 *   session    - the authenticated session
 *
 * Organization-scoped limits are applied inside services, after authorization,
 * so an outsider can never consume another organization's bucket.
 */
export type RateLimitSubject = 'ip' | 'email' | 'user' | 'session';

const RULES = 'ventidoc:rateLimitRules';

interface Rule {
  policy: PolicyName;
  subject: RateLimitSubject;
}

export function subjectFor(req: VentidocRequest, subject: RateLimitSubject, ipv6Prefix: number): string {
  switch (subject) {
    case 'ip':
      return `ip:${rateLimitNetwork(req.clientIp ?? null, ipv6Prefix)}`;
    case 'email': {
      const raw = (req.body as { email?: unknown } | undefined)?.email;
      return `email:${typeof raw === 'string' ? normalizeEmail(raw).slice(0, 254) : ''}`;
    }
    case 'user':
      if (!req.auth) throw new Error('user-keyed rate limit on an unauthenticated route');
      return `user:${req.auth.userId}`;
    case 'session':
      if (!req.auth) throw new Error('session-keyed rate limit on an unauthenticated route');
      return `session:${req.auth.sessionId}`;
  }
}

@Injectable()
export class RouteRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = (Reflect.getMetadata(RULES, context.getHandler()) as Rule[] | undefined) ?? [];
    const req = context.switchToHttp().getRequest<VentidocRequest>();
    for (const rule of rules) {
      await this.limiter.enforce(rule.policy, subjectFor(req, rule.subject, this.config.rateLimitIpv6Prefix));
    }
    return true;
  }
}

/**
 * Global coarse limit on every route, keyed by client network. Registered before
 * AuthGuard so floods are shed before any database work. Fails open: it guards
 * capacity, not credentials.
 */
@Injectable()
export class DefaultRateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimiter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<VentidocRequest>();
    await this.limiter.enforce('default.ip', subjectFor(req, 'ip', this.config.rateLimitIpv6Prefix));
    return true;
  }
}

/**
 * Adds a limit to a route. Stackable; rules run in declaration order.
 * The guard is attached once per handler no matter how many rules are stacked:
 * attaching it per rule would run every rule once per attachment (double charging).
 */
export function RateLimit(policy: PolicyName, subject: RateLimitSubject) {
  return (target: object, key: string | symbol, descriptor: PropertyDescriptor) => {
    const handler = descriptor.value as object;
    const existing = (Reflect.getMetadata(RULES, handler) as Rule[] | undefined) ?? [];
    // Decorators apply bottom-up; prepending keeps declaration order.
    Reflect.defineMetadata(RULES, [{ policy, subject }, ...existing], handler);
    if (existing.length === 0) UseGuards(RouteRateLimitGuard)(target, key, descriptor);
    return descriptor;
  };
}

export function rateLimitRules(handler: object): Rule[] {
  return (Reflect.getMetadata(RULES, handler) as Rule[] | undefined) ?? [];
}
