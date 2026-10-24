import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import { sealWith } from '../common/keyring';
import { normalizeEmail } from '../common/crypto';
import { PrismaService } from '../database/prisma.service';
import type { Tx } from '../database/tenant-db.service';
import { EmailEvent, EVENT_TTL_MS, templateKeyFor } from './events';

export const outboxAad = (outboxId: string) => `ventidoc-email-outbox:${outboxId}`;

/**
 * The provider-independent entry point for every email. `enqueue` only writes an
 * outbox row (no provider call, no network), in the caller's transaction when one is
 * given: the email exists if and only if the business change committed.
 *
 * createMany is used (INSERT without RETURNING): an organization-scoped caller may
 * insert its own rows but, by design, cannot read the outbox back (RLS).
 */
@Injectable()
export class EmailService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async enqueue(event: EmailEvent, tx?: Tx | null, opts: { testSend?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    const row = this.toRow(id, event);
    await (tx ?? this.prisma).emailOutbox.createMany({
      data: [{
        id,
        eventType: event.type,
        templateKey: templateKeyFor(event),
        organizationId: row.organizationId,
        recipientUserId: row.recipientUserId,
        recipientEmail: row.recipientEmail,
        payload: row.payload,
        sensitiveCiphertext: row.sensitive ? sealWith(this.config.emailKeyRing, outboxAad(id), JSON.stringify(row.sensitive)) : null,
        expiresAt: new Date(Date.now() + EVENT_TTL_MS[event.type]),
        idempotencyKey: `vd-${id}`,
        testSend: opts.testSend ?? false,
      }],
    });
    return id;
  }

  /** Plain link to a page of the web app (no token). */
  page(path: string): string {
    return new URL(path, this.config.appPublicUrl).toString();
  }

  /** Builds the sendable link to the web app; the token goes in the fragment (never in server logs). */
  link(path: string, token: string): string {
    const url = new URL(path, this.config.appPublicUrl);
    url.hash = `token=${token}`;
    return url.toString();
  }

  private toRow(_id: string, e: EmailEvent): {
    organizationId: string | null; recipientUserId: string | null; recipientEmail: string | null;
    payload: Record<string, string | number>; sensitive: Record<string, string> | null;
  } {
    switch (e.type) {
      case 'auth.verify_email':
        return { organizationId: null, recipientUserId: e.userId, recipientEmail: null, payload: {}, sensitive: null };
      case 'auth.verify_email_resend':
      case 'auth.password_reset':
      case 'auth.signup_attempt':
        return { organizationId: null, recipientUserId: null, recipientEmail: normalizeEmail(e.email), payload: {}, sensitive: null };
      case 'org.invitation':
        return {
          organizationId: e.organizationId, recipientUserId: null, recipientEmail: normalizeEmail(e.email),
          payload: { orgName: e.orgName, inviterName: e.inviterName }, sensitive: { invitationToken: e.sensitive.invitationToken },
        };
      case 'mfa.enrollment_code':
        return { organizationId: null, recipientUserId: e.userId, recipientEmail: null, payload: {}, sensitive: { code: e.sensitive.code } };
      case 'security.notice':
        return { organizationId: null, recipientUserId: e.userId, recipientEmail: null, payload: e.remaining === undefined ? {} : { remaining: e.remaining }, sensitive: null };
      case 'platform.test':
        return { organizationId: null, recipientUserId: null, recipientEmail: normalizeEmail(e.to), payload: { requestedBy: e.requestedBy }, sensitive: null };
      case 'support.reply':
      case 'support.customer_message':
      case 'support.assigned':
        return { organizationId: null, recipientUserId: e.userId, recipientEmail: null, payload: { conversationId: e.conversationId, reference: e.reference }, sensitive: null };
      case 'support.status_changed':
        return {
          organizationId: null, recipientUserId: e.userId, recipientEmail: null,
          payload: { conversationId: e.conversationId, reference: e.reference, status: e.status }, sensitive: null,
        };
    }
  }
}
