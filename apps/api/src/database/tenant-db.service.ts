import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { EffectiveAccess } from '../authz/permission-evaluator';
import { PrismaService } from './prisma.service';

export type Tx = Prisma.TransactionClient;

const CONTEXT_KEYS = ['app.org_id', 'app.user_id', 'app.platform_scope', 'app.invitation_token_hash'] as const;
type ContextKey = (typeof CONTEXT_KEYS)[number];

interface TxOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeoutMs?: number;
}

/**
 * The single entry point for queries that touch tenant-owned tables.
 *
 * Every method opens a transaction and sets PostgreSQL settings with
 * set_config(name, value, is_local => true). Transaction-local settings are reset
 * on COMMIT/ROLLBACK, so they are safe with connection pooling (including
 * PgBouncer in transaction mode) and cannot leak into another request.
 *
 * inOrg() only accepts an EffectiveAccess, which only OrgAuthzService produces
 * after validating the caller's active membership. A client-supplied organization
 * ID therefore cannot open a tenant context by itself. RLS is defense in depth
 * behind that check, not a replacement for it.
 */
@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  /** Run inside the tenant context of an organization the caller is authorized for. */
  inOrg<T>(access: EffectiveAccess, fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
    return this.run({ 'app.org_id': access.organizationId, 'app.user_id': access.userId }, fn, opts);
  }

  /**
   * Tenant context WITHOUT a prior application-level membership check. Used only by:
   *   - OrgAuthzService (loading the membership itself; a non-member sees nothing)
   *   - creating a new organization (the ID is generated server-side)
   * The database still enforces membership: since migration
   * 20261022120100_membership_bound_rls every tenant policy requires the context
   * user to be an active member (with a creator bootstrap for brand-new orgs).
   */
  inOrgUnchecked<T>(orgId: string, userId: string, fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
    return this.run({ 'app.org_id': orgId, 'app.user_id': userId }, fn, opts);
  }

  /**
   * Context for accepting an invitation. The database grants the (not yet member)
   * user access to the organization's RBAC tables only if `invitationTokenHash`
   * matches a live invitation addressed to that user's verified email.
   */
  acceptingInvitation<T>(orgId: string, userId: string, invitationTokenHash: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.run({ 'app.org_id': orgId, 'app.user_id': userId, 'app.invitation_token_hash': invitationTokenHash }, fn, {});
  }

  /** Run with only the user identity set (e.g. list "my organizations"). */
  asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
    return this.run({ 'app.user_id': userId }, fn, opts);
  }

  /**
   * Platform-administration scope. RLS exposes only organization metadata,
   * subscriptions and audit events here; business data stays invisible.
   * Callers must have passed PlatformAccessGuard.
   */
  asPlatform<T>(userId: string, fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
    return this.run({ 'app.platform_scope': 'on', 'app.user_id': userId }, fn, opts);
  }

  private run<T>(settings: Partial<Record<ContextKey, string>>, fn: (tx: Tx) => Promise<T>, opts: TxOptions): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        // Every key is written on every transaction (empty = unset), so no value can
        // survive from anywhere else, even if a session-level SET ever slipped in.
        for (const key of CONTEXT_KEYS) {
          await tx.$queryRaw`SELECT set_config(${key}, ${settings[key] ?? ''}, true)`;
        }
        return fn(tx);
      },
      { isolationLevel: opts.isolationLevel, timeout: opts.timeoutMs ?? 10_000, maxWait: 5_000 },
    );
  }
}
