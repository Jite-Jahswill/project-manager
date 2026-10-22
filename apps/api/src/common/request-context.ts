import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { EffectiveAccess } from '../authz/permission-evaluator';

/** Identity established by AuthGuard from a valid, unrevoked session. */
export interface AuthIdentity {
  userId: string;
  sessionId: string;
  reauthenticatedAt: Date | null;
}

/** Request metadata recorded on audit events. Never contains credentials. */
export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface VentidocRequest extends Request {
  auth?: AuthIdentity;
  orgAccess?: EffectiveAccess;
  requestId?: string;
}

export function requestMeta(req: VentidocRequest): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
    requestId: req.requestId ?? null,
  };
}

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthIdentity => {
  const req = ctx.switchToHttp().getRequest<VentidocRequest>();
  if (!req.auth) throw new Error('Auth identity missing: route is not behind AuthGuard');
  return req.auth;
});

/** The authorized organization access computed by OrgAccessGuard for this request. */
export const OrgAccess = createParamDecorator((_: unknown, ctx: ExecutionContext): EffectiveAccess => {
  const req = ctx.switchToHttp().getRequest<VentidocRequest>();
  if (!req.orgAccess) throw new Error('Org access missing: route is not behind OrgAccessGuard');
  return req.orgAccess;
});

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta =>
  requestMeta(ctx.switchToHttp().getRequest<VentidocRequest>()),
);
