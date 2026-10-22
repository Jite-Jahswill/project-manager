import { Injectable } from '@nestjs/common';
import { ActorType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { Tx } from '../database/tenant-db.service';
import type { RequestMeta } from '../common/request-context';

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  organizationId?: string | null;
  branchId?: string | null;
  actorType?: ActorType;
  actorUserId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Keys that must never be written to the audit log, at any depth. */
const REDACTED_KEYS = /pass(word)?|token|secret|hash|authorization|cookie|otp|mfa/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACTED_KEYS.test(k) ? '[redacted]' : redact(v)]),
    );
  }
  return typeof value === 'bigint' ? value.toString() : value;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(redact(value), (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/**
 * Append-only audit log. Pass the transaction that performs the audited change so
 * the event commits or rolls back with it. The database rejects UPDATE/DELETE on
 * audit_events for every role (trigger) and the app role has no such privilege.
 *
 * createMany is used deliberately: it issues INSERT without RETURNING, so writing
 * an identity event (organization_id NULL) does not require read access to it.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tx: Tx | null, entry: AuditEntry, meta?: RequestMeta): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditEvent.createMany({
      data: [
        {
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          organizationId: entry.organizationId ?? null,
          branchId: entry.branchId ?? null,
          actorType: entry.actorType ?? (entry.actorUserId ? 'USER' : 'SYSTEM'),
          actorUserId: entry.actorUserId ?? null,
          before: toJson(entry.before),
          after: toJson(entry.after),
          metadata: toJson(entry.metadata),
          ipAddress: meta?.ipAddress ?? null,
          userAgent: meta?.userAgent ?? null,
          requestId: meta?.requestId ?? null,
        },
      ],
    });
  }
}
