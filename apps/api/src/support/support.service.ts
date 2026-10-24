import { HttpStatus, Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { ApiError, Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { EmailService } from '../email/email.service';
import { Prisma } from '../generated/prisma/client';
import { decodeCursor, encodeCursor } from './cursor';
import {
  canTransition, ConversationClosedError, customerMayReopen, previewOf, statusAfterCustomerMessage, statusAfterStaffReply, SupportStatus,
} from './lifecycle';
import { StaffAccess, staffCanSee } from './support-access';
import { SupportEvent, SupportRealtimeService } from './support-realtime.service';
import type {
  AssignDto, CreateConversationDto, InboxQuery, ListOwnQuery, MessagesQuery, NoteDto, SendMessageDto, UpdateConversationDto,
} from './dto/support.dto';

/** Who is acting: the customer side or a staff member with their resolved support access. */
export type Viewer = { kind: 'customer'; userId: string } | { kind: 'staff'; userId: string; access: StaffAccess };

type Conversation = Prisma.SupportConversationGetPayload<object>;

interface MessageRow {
  id: string; seq: number; authorUserId: string; authorKind: 'CUSTOMER' | 'STAFF'; body: string; createdAt: Date;
  attachments: { id: string; fileName: string; contentType: string; sizeBytes: number }[]; author: { displayName: string };
}

interface LockedConversation {
  id: string; reference: string; customer_user_id: string; assignee_user_id: string | null; status: SupportStatus;
  version: number; message_seq: number; customer_read_seq: number; support_read_seq: number;
  customer_notified_seq: number; assignee_notified_seq: number;
}

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ACTIVE_STATUSES: SupportStatus[] = ['NEW', 'OPEN', 'PENDING_CUSTOMER', 'PENDING_SUPPORT'];

function newReference(): string {
  let s = 'SUP-';
  for (let i = 0; i < 8; i++) s += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return s;
}

const notFound = () => Errors.notFound('Conversation');

/** Escapes LIKE metacharacters (PostgreSQL's default escape character is the backslash). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Customer support conversations (docs/architecture/09-support.md).
 *
 * Every query runs in the caller's user context (TenantDb.asUser), so RLS applies the
 * same visibility rules as this service: customers see their own conversations; staff see
 * the inbox (platform.support.inbox.read) or their assignments (platform.support.assigned.access).
 * The service re-checks the rule for the route being used (a staff member acting through a
 * customer route only reaches their own conversations, and vice versa).
 *
 * Writes that change a conversation lock its row (SELECT … FOR UPDATE), so message numbering,
 * status changes and assignments are serialized per conversation. Real-time events are
 * published after commit; notifications are enqueued in the same transaction (email outbox).
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly realtime: SupportRealtimeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Customer
  // ---------------------------------------------------------------------------

  async create(userId: string, dto: CreateConversationDto, meta: RequestMeta) {
    const id = randomUUID();
    const body = dto.body.trim();
    const result = await this.db.asUser(userId, async (tx) => {
      if (dto.organizationId) {
        const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT app_user_is_active_member_of(${dto.organizationId}::uuid) AS ok`;
        if (!row?.ok) throw Errors.badRequest('invalid_organization', 'You can only link an organization you are an active member of');
      }
      const now = new Date();
      await tx.supportConversation.create({
        data: {
          id, reference: newReference(), customerUserId: userId, organizationId: dto.organizationId ?? null,
          subject: dto.subject.trim(), category: dto.category ?? 'OTHER', messageSeq: 1, customerReadSeq: 1,
          lastMessagePreview: previewOf(body), lastMessageAt: now, lastActivityAt: now,
        },
      });
      await tx.supportMessage.create({
        data: { conversationId: id, seq: 1, authorUserId: userId, authorKind: 'CUSTOMER', body, clientMessageId: dto.clientMessageId ?? null },
      });
      await tx.supportConversationEvent.createMany({ data: [{ conversationId: id, type: 'CREATED', actorUserId: userId, actorKind: 'CUSTOMER', data: { category: dto.category ?? 'OTHER' } }] });
      // Never tag support audit events with the organization: its members can read those.
      await this.audit.record(tx, { action: 'support.conversation.created', resourceType: 'support_conversation', resourceId: id, actorUserId: userId }, meta);
      return tx.supportConversation.findUniqueOrThrow({ where: { id } });
    });
    await this.realtime.publish(this.event('conversation.created', result, 'staff', { conversation: this.staffSummary(result) }));
    return this.customerView(result, 0);
  }

  async listOwn(userId: string, q: ListOwnQuery) {
    const limit = q.limit ?? 25;
    const cursor = decodeCursor(q.cursor);
    return this.db.asUser(userId, async (tx) => {
      const rows = await tx.supportConversation.findMany({
        where: {
          customerUserId: userId,
          ...(q.status ? { status: q.status } : {}),
          ...(cursor ? { OR: [{ lastActivityAt: { lt: cursor.at } }, { lastActivityAt: cursor.at, id: { lt: cursor.id } }] } : {}),
        },
        orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const unread = await this.customerUnread(tx, page.map((c) => c.id));
      return {
        items: page.map((c) => this.customerView(c, unread.get(c.id) ?? 0)),
        nextCursor: rows.length > limit ? encodeCursor({ at: page[page.length - 1].lastActivityAt, id: page[page.length - 1].id }) : null,
      };
    });
  }

  getOwn(userId: string, conversationId: string) {
    return this.db.asUser(userId, async (tx) => {
      const c = await this.ownConversation(tx, userId, conversationId);
      const unread = await this.customerUnread(tx, [c.id]);
      return this.customerView(c, unread.get(c.id) ?? 0);
    });
  }

  async customerUnreadSummary(userId: string) {
    return this.db.asUser(userId, async (tx) => {
      const [row] = await tx.$queryRaw<{ conversations: number; messages: number }[]>`
        SELECT count(DISTINCT c.id)::int AS conversations, count(m.id)::int AS messages
        FROM support_conversations c
        JOIN support_messages m ON m.conversation_id = c.id AND m.author_kind = 'STAFF' AND m.seq > c.customer_read_seq
        WHERE c.customer_user_id = ${userId}::uuid`;
      return row ?? { conversations: 0, messages: 0 };
    });
  }

  async reopen(userId: string, conversationId: string, meta: RequestMeta) {
    const result = await this.db.asUser(userId, async (tx) => {
      const c = await this.lock(tx, conversationId);
      if (!c || c.customer_user_id !== userId) throw notFound();
      if (!customerMayReopen(c.status)) {
        throw Errors.conflict(c.status === 'CLOSED' ? 'conversation_closed' : 'not_resolved',
          c.status === 'CLOSED' ? 'A closed conversation cannot be reopened; start a new one' : 'Only a resolved conversation can be reopened');
      }
      await tx.supportConversation.update({ where: { id: c.id }, data: { status: 'PENDING_SUPPORT', lastActivityAt: new Date() } });
      await tx.supportConversationEvent.createMany({ data: [{ conversationId: c.id, type: 'REOPENED', actorUserId: userId, actorKind: 'CUSTOMER', data: { from: c.status, to: 'PENDING_SUPPORT' } }] });
      await this.audit.record(tx, { action: 'support.conversation.reopened', resourceType: 'support_conversation', resourceId: c.id, actorUserId: userId }, meta);
      return tx.supportConversation.findUniqueOrThrow({ where: { id: c.id } });
    });
    await this.realtime.publish(this.event('conversation.updated', result, 'public', { status: result.status }, { version: result.version }));
    return this.customerView(result, 0);
  }

  // ---------------------------------------------------------------------------
  // Shared: messages, read markers
  // ---------------------------------------------------------------------------

  listMessages(viewer: Viewer, conversationId: string, q: MessagesQuery) {
    const limit = q.limit ?? 50;
    if (q.afterSeq !== undefined && q.beforeSeq !== undefined) throw Errors.badRequest('invalid_range', 'Use either afterSeq or beforeSeq');
    return this.db.asUser(viewer.userId, async (tx) => {
      const c = await this.visible(tx, viewer, conversationId);
      // afterSeq: catch-up after a reconnect (ascending). beforeSeq / default: latest page, older history.
      const ascending = q.afterSeq !== undefined;
      const rows = await tx.supportMessage.findMany({
        where: {
          conversationId: c.id,
          ...(q.afterSeq !== undefined ? { seq: { gt: q.afterSeq } } : {}),
          ...(q.beforeSeq !== undefined ? { seq: { lt: q.beforeSeq } } : {}),
        },
        orderBy: { seq: ascending ? 'asc' : 'desc' },
        take: limit + 1,
        include: { attachments: { select: { id: true, fileName: true, contentType: true, sizeBytes: true } }, author: { select: { displayName: true } } },
      });
      const page = rows.slice(0, limit);
      const ordered = ascending ? page : [...page].reverse();
      return {
        items: ordered.map((m) => this.messageView(viewer, m)),
        hasMore: rows.length > limit,
        latestSeq: c.messageSeq,
      };
    });
  }

  async sendMessage(viewer: Viewer, conversationId: string, dto: SendMessageDto, meta: RequestMeta) {
    if (viewer.kind === 'staff' && !viewer.access.reply) throw Errors.forbidden();
    const body = dto.body.trim();
    const outcome = await this.db.asUser(viewer.userId, async (tx) => {
      const c = await this.lock(tx, conversationId);
      if (!c || !this.lockedVisible(viewer, c)) throw notFound();
      if (dto.clientMessageId) {
        const existing = await tx.supportMessage.findFirst({
          where: { conversationId: c.id, authorUserId: viewer.userId, clientMessageId: dto.clientMessageId },
          include: { attachments: { select: { id: true, fileName: true, contentType: true, sizeBytes: true } }, author: { select: { displayName: true } } },
        });
        if (existing) {
          if (existing.body !== body) throw Errors.conflict('idempotency_conflict', 'This clientMessageId was already used for a different message');
          return { duplicate: true as const, message: existing };
        }
      }
      let next: SupportStatus;
      try {
        next = viewer.kind === 'customer' ? statusAfterCustomerMessage(c.status) : statusAfterStaffReply(c.status);
      } catch (e) {
        if (e instanceof ConversationClosedError) throw Errors.conflict('conversation_closed', 'This conversation is closed; start a new one');
        throw e;
      }
      const seq = c.message_seq + 1;
      const now = new Date();
      const notifyCustomer = viewer.kind === 'staff' && c.customer_notified_seq <= c.customer_read_seq;
      const notifyAssignee = viewer.kind === 'customer' && !!c.assignee_user_id && c.assignee_notified_seq <= c.support_read_seq;
      await tx.supportConversation.update({
        where: { id: c.id },
        data: {
          messageSeq: seq, lastMessagePreview: previewOf(body), lastMessageAt: now, lastActivityAt: now,
          ...(next !== c.status ? { status: next } : {}),
          // Writing a message means having read the conversation up to it.
          ...(viewer.kind === 'customer' ? { customerReadSeq: seq } : { supportReadSeq: seq }),
          ...(notifyCustomer ? { customerNotifiedSeq: seq } : {}),
          ...(notifyAssignee ? { assigneeNotifiedSeq: seq } : {}),
        },
      });
      const message = await tx.supportMessage.create({
        data: {
          conversationId: c.id, seq, authorUserId: viewer.userId, authorKind: viewer.kind === 'customer' ? 'CUSTOMER' : 'STAFF',
          body, clientMessageId: dto.clientMessageId ?? null,
        },
      });
      const attachmentIds = [...new Set(dto.attachmentIds ?? [])];
      if (attachmentIds.length) {
        const linked = await tx.supportAttachment.updateMany({
          where: { id: { in: attachmentIds }, conversationId: c.id, uploaderUserId: viewer.userId, messageId: null },
          data: { messageId: message.id },
        });
        if (linked.count !== attachmentIds.length) {
          throw Errors.badRequest('invalid_attachments', 'Attachments must be your own, unsent uploads to this conversation');
        }
      }
      if (viewer.kind === 'staff') await this.upsertMarker(tx, c.id, viewer.userId, seq);
      if (next !== c.status) {
        await tx.supportConversationEvent.createMany({
          data: [{
            conversationId: c.id, type: c.status === 'RESOLVED' && viewer.kind === 'customer' ? 'REOPENED' : 'STATUS_CHANGED',
            actorUserId: viewer.userId, actorKind: viewer.kind === 'customer' ? 'CUSTOMER' : 'STAFF', data: { from: c.status, to: next, cause: 'message' },
          }],
        });
      }
      if (viewer.kind === 'staff') {
        await this.audit.record(tx, {
          action: 'platform.support.replied', resourceType: 'support_conversation', resourceId: c.id, actorType: 'PLATFORM_ADMIN',
          actorUserId: viewer.userId, metadata: { seq, attachments: attachmentIds.length },
        }, meta);
      }
      if (notifyCustomer) await this.email.enqueue({ type: 'support.reply', userId: c.customer_user_id, conversationId: c.id, reference: c.reference }, tx);
      if (notifyAssignee) await this.email.enqueue({ type: 'support.customer_message', userId: c.assignee_user_id!, conversationId: c.id, reference: c.reference }, tx);
      const full = await tx.supportMessage.findUniqueOrThrow({
        where: { id: message.id },
        include: { attachments: { select: { id: true, fileName: true, contentType: true, sizeBytes: true } }, author: { select: { displayName: true } } },
      });
      const conversation = await tx.supportConversation.findUniqueOrThrow({ where: { id: c.id } });
      return { duplicate: false as const, message: full, conversation, statusChanged: next !== c.status };
    });
    if (outcome.duplicate) return { duplicate: true, message: this.messageView(viewer, outcome.message) };
    const { message, conversation } = outcome;
    await this.realtime.publish(this.event('message.created', conversation, 'public',
      { message: this.customerMessageView(conversation.customerUserId, message), status: conversation.status, latestSeq: conversation.messageSeq },
      { message: this.staffMessageView(message) }));
    return { duplicate: false, message: this.messageView(viewer, message), conversation: this.viewFor(viewer, conversation) };
  }

  async markRead(viewer: Viewer, conversationId: string, upToSeq: number) {
    const result = await this.db.asUser(viewer.userId, async (tx) => {
      const c = await this.lock(tx, conversationId);
      if (!c || !this.lockedVisible(viewer, c)) throw notFound();
      const seq = Math.min(upToSeq, c.message_seq);
      if (viewer.kind === 'customer') {
        if (seq > c.customer_read_seq) await tx.supportConversation.update({ where: { id: c.id }, data: { customerReadSeq: seq } });
        return { conversation: c, lastReadSeq: Math.max(seq, c.customer_read_seq) };
      }
      const marker = await this.upsertMarker(tx, c.id, viewer.userId, seq);
      if (seq > c.support_read_seq) await tx.supportConversation.update({ where: { id: c.id }, data: { supportReadSeq: seq } });
      return { conversation: c, lastReadSeq: marker };
    });
    const c = result.conversation;
    // Other sessions of the same user update their unread badges.
    await this.realtime.publish({
      type: 'read.updated', conversationId: c.id, customerUserId: c.customer_user_id, assigneeUserId: c.assignee_user_id,
      audience: 'self', targetUserId: viewer.userId, data: { lastReadSeq: result.lastReadSeq },
    });
    return { lastReadSeq: result.lastReadSeq };
  }

  // ---------------------------------------------------------------------------
  // Staff
  // ---------------------------------------------------------------------------

  async inbox(access: StaffAccess, q: InboxQuery) {
    const limit = q.limit ?? 25;
    const cursor = decodeCursor(q.cursor);
    const sortField = q.sort === 'created' ? 'createdAt' : 'lastActivityAt';
    const dir = q.order === 'asc' ? 'asc' : 'desc';
    let assignee: Prisma.SupportConversationWhereInput = {};
    if (!access.inbox) {
      // Agents work their own queue only; the global inbox and unassigned queue need inbox.read.
      if (q.assignee && q.assignee !== 'me') throw Errors.forbidden('Browsing the support inbox requires platform.support.inbox.read');
      assignee = { assigneeUserId: access.userId };
    } else if (q.assignee === 'me') assignee = { assigneeUserId: access.userId };
    else if (q.assignee === 'unassigned') assignee = { assigneeUserId: null };
    else if (q.assignee) assignee = { assigneeUserId: q.assignee };
    const search = q.q?.trim();
    const where: Prisma.SupportConversationWhereInput = {
      AND: [
        assignee,
        q.status?.length ? { status: { in: q.status } } : {},
        q.priority ? { priority: q.priority } : {},
        q.category ? { category: q.category } : {},
        q.customerUserId ? { customerUserId: q.customerUserId } : {},
        q.organizationId ? { organizationId: q.organizationId } : {},
        // Prisma does not escape LIKE wildcards in `contains`: % and _ must match literally.
        search ? { OR: [{ reference: search.toUpperCase() }, { subject: { contains: escapeLike(search), mode: 'insensitive' } }] } : {},
        cursor
          ? { OR: [{ [sortField]: { [dir === 'desc' ? 'lt' : 'gt']: cursor.at } }, { [sortField]: cursor.at, id: { [dir === 'desc' ? 'lt' : 'gt']: cursor.id } }] }
          : {},
      ],
    };
    return this.db.asUser(access.userId, async (tx) => {
      const rows = await tx.supportConversation.findMany({
        where, orderBy: [{ [sortField]: dir }, { id: dir }], take: limit + 1,
        include: { customer: { select: { id: true, email: true, displayName: true } }, assignee: { select: { user: { select: { id: true, displayName: true } } } } },
      });
      const page = rows.slice(0, limit);
      const unread = await this.staffUnread(tx, access.userId, page.map((c) => c.id));
      const last = page[page.length - 1];
      return {
        items: page.map((c) => this.staffView(c, unread.get(c.id) ?? 0)),
        nextCursor: rows.length > limit ? encodeCursor({ at: last[sortField], id: last.id }) : null,
      };
    });
  }

  async staffGet(access: StaffAccess, conversationId: string, meta: RequestMeta) {
    const view = await this.db.asUser(access.userId, async (tx) => {
      const c = await tx.supportConversation.findUnique({
        where: { id: conversationId },
        include: { customer: { select: { id: true, email: true, displayName: true } }, assignee: { select: { user: { select: { id: true, displayName: true } } } } },
      });
      if (!c || !staffCanSee(access, c)) throw notFound();
      const unread = await this.staffUnread(tx, access.userId, [c.id]);
      // Administrative reads of customer conversations are audited.
      await this.audit.record(tx, {
        action: 'platform.support.conversation.viewed', resourceType: 'support_conversation', resourceId: c.id,
        actorType: 'PLATFORM_ADMIN', actorUserId: access.userId,
      }, meta);
      return this.staffView(c, unread.get(c.id) ?? 0);
    });
    return view;
  }

  async addNote(access: StaffAccess, conversationId: string, dto: NoteDto, meta: RequestMeta) {
    if (!access.notes) throw Errors.forbidden();
    const body = dto.body.trim();
    const result = await this.db.asUser(access.userId, async (tx) => {
      const c = await this.lock(tx, conversationId);
      if (!c || !staffCanSee(access, { assigneeUserId: c.assignee_user_id })) throw notFound();
      if (dto.clientNoteId) {
        const existing = await tx.supportInternalNote.findFirst({ where: { conversationId: c.id, authorUserId: access.userId, clientNoteId: dto.clientNoteId } });
        if (existing) {
          if (existing.body !== body) throw Errors.conflict('idempotency_conflict', 'This clientNoteId was already used for a different note');
          return { conversation: c, note: existing, duplicate: true };
        }
      }
      const note = await tx.supportInternalNote.create({ data: { conversationId: c.id, authorUserId: access.userId, body, clientNoteId: dto.clientNoteId ?? null } });
      await tx.supportConversationEvent.createMany({ data: [{ conversationId: c.id, type: 'NOTE_ADDED', actorUserId: access.userId, actorKind: 'STAFF', data: { noteId: note.id } }] });
      await this.audit.record(tx, {
        action: 'platform.support.note_added', resourceType: 'support_conversation', resourceId: c.id, actorType: 'PLATFORM_ADMIN',
        actorUserId: access.userId, metadata: { noteId: note.id },
      }, meta);
      return { conversation: c, note, duplicate: false };
    });
    const c = result.conversation;
    if (!result.duplicate) {
      // Staff-only, and without the text: clients with notes access fetch it.
      await this.realtime.publish({
        type: 'note.created', conversationId: c.id, customerUserId: c.customer_user_id, assigneeUserId: c.assignee_user_id,
        audience: 'staff', requires: 'notes', data: { noteId: result.note.id },
      });
    }
    return { duplicate: result.duplicate, note: this.noteView(result.note) };
  }

  listNotes(access: StaffAccess, conversationId: string) {
    if (!access.notes) throw Errors.forbidden();
    return this.db.asUser(access.userId, async (tx) => {
      const c = await this.visible(tx, { kind: 'staff', userId: access.userId, access }, conversationId);
      const notes = await tx.supportInternalNote.findMany({
        where: { conversationId: c.id }, orderBy: { createdAt: 'asc' }, take: 500, include: { author: { select: { displayName: true } } },
      });
      return { items: notes.map((n) => ({ ...this.noteView(n), author: { userId: n.authorUserId, displayName: n.author.displayName } })) };
    });
  }

  async assign(access: StaffAccess, conversationId: string, dto: AssignDto, meta: RequestMeta) {
    if (!access.assign) throw Errors.forbidden();
    const target = dto.assigneeUserId;
    const result = await this.db.asUser(access.userId, async (tx) => {
      const c = await this.lock(tx, conversationId);
      if (!c || !staffCanSee(access, { assigneeUserId: c.assignee_user_id })) throw notFound();
      if (c.status === 'CLOSED') throw Errors.conflict('conversation_closed', 'A closed conversation cannot be reassigned');
      // Compare-and-set: two administrators picking the same conversation cannot both win.
      if (c.assignee_user_id !== (dto.expectedAssigneeUserId ?? null)) {
        throw new ApiError(HttpStatus.CONFLICT, 'assignment_conflict', 'The conversation was assigned by someone else in the meantime; reload and retry');
      }
      if (c.assignee_user_id === target) return { conversation: c, changed: false };
      const reassigning = c.assignee_user_id !== null && target !== null;
      if (reassigning && !dto.reason?.trim()) throw Errors.badRequest('reason_required', 'Reassigning a conversation requires a reason');
      if (target) {
        const [row] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT app_user_has_platform_permission(${target}::uuid, 'platform.support.assigned.access') AS ok`;
        if (!row?.ok) throw Errors.badRequest('invalid_assignee', 'The assignee must be an active support staff member (platform.support.assigned.access)');
      }
      await tx.supportConversation.update({ where: { id: c.id }, data: { assigneeUserId: target, lastActivityAt: new Date(), assigneeNotifiedSeq: c.message_seq } });
      await tx.supportAssignment.createMany({
        data: [{ conversationId: c.id, previousAssigneeUserId: c.assignee_user_id, assigneeUserId: target, assignedByUserId: access.userId, reason: dto.reason?.trim() || null }],
      });
      const type = target === null ? 'UNASSIGNED' : reassigning ? 'REASSIGNED' : 'ASSIGNED';
      await tx.supportConversationEvent.createMany({
        data: [{ conversationId: c.id, type, actorUserId: access.userId, actorKind: 'STAFF', data: { from: c.assignee_user_id, to: target } }],
      });
      await this.audit.record(tx, {
        action: `platform.support.${type.toLowerCase()}`, resourceType: 'support_conversation', resourceId: c.id, actorType: 'PLATFORM_ADMIN',
        actorUserId: access.userId, before: { assigneeUserId: c.assignee_user_id }, after: { assigneeUserId: target }, metadata: { reason: dto.reason?.trim() || null },
      }, meta);
      if (target && target !== access.userId) {
        await this.email.enqueue({ type: 'support.assigned', userId: target, conversationId: c.id, reference: c.reference }, tx);
      }
      return { conversation: await tx.supportConversation.findUniqueOrThrow({ where: { id: c.id } }), changed: true, previous: c.assignee_user_id };
    });
    if (result.changed && 'previous' in result) {
      const conv = result.conversation as Conversation;
      await this.realtime.publish({
        ...this.event('conversation.assigned', conv, 'public', { assigned: conv.assigneeUserId !== null }, { assigneeUserId: conv.assigneeUserId, version: conv.version }),
        previousAssigneeUserId: result.previous ?? null,
      });
    }
    return this.assignmentSummary(access, conversationId);
  }

  async update(access: StaffAccess, conversationId: string, dto: UpdateConversationDto, meta: RequestMeta) {
    if (!access.status) throw Errors.forbidden();
    if (dto.status === undefined && dto.priority === undefined && dto.category === undefined) {
      throw Errors.badRequest('nothing_to_update', 'Provide status, priority or category');
    }
    const result = await this.db.asUser(access.userId, async (tx) => {
      const c = await this.lock(tx, conversationId);
      if (!c || !staffCanSee(access, { assigneeUserId: c.assignee_user_id })) throw notFound();
      const before = await tx.supportConversation.findUniqueOrThrow({ where: { id: c.id } });
      if (before.version !== dto.version) {
        throw new ApiError(HttpStatus.CONFLICT, 'version_conflict', `The conversation changed (current version ${before.version}); reload and retry`);
      }
      if (before.status === 'CLOSED') throw Errors.conflict('conversation_closed', 'A closed conversation cannot change');
      if (dto.status && !canTransition(before.status, dto.status)) {
        throw Errors.conflict('invalid_transition', `Cannot change status from ${before.status} to ${dto.status}`);
      }
      const data: Prisma.SupportConversationUpdateInput = { lastActivityAt: new Date() };
      const events: Prisma.SupportConversationEventCreateManyInput[] = [];
      const ev = (type: Prisma.SupportConversationEventCreateManyInput['type'], from: string, to: string) =>
        events.push({ conversationId: c.id, type, actorUserId: access.userId, actorKind: 'STAFF', data: { from, to } });
      if (dto.status && dto.status !== before.status) { data.status = dto.status; ev('STATUS_CHANGED', before.status, dto.status); }
      if (dto.priority && dto.priority !== before.priority) { data.priority = dto.priority; ev('PRIORITY_CHANGED', before.priority, dto.priority); }
      if (dto.category && dto.category !== before.category) { data.category = dto.category; ev('CATEGORY_CHANGED', before.category, dto.category); }
      if (!events.length) return { conversation: before, changed: false };
      const after = await tx.supportConversation.update({ where: { id: c.id }, data });
      await tx.supportConversationEvent.createMany({ data: events });
      await this.audit.record(tx, {
        action: 'platform.support.conversation.updated', resourceType: 'support_conversation', resourceId: c.id, actorType: 'PLATFORM_ADMIN',
        actorUserId: access.userId,
        before: { status: before.status, priority: before.priority, category: before.category },
        after: { status: after.status, priority: after.priority, category: after.category },
      }, meta);
      if (data.status && (after.status === 'RESOLVED' || after.status === 'CLOSED')) {
        await this.email.enqueue({ type: 'support.status_changed', userId: after.customerUserId, conversationId: c.id, reference: c.reference, status: after.status }, tx);
      }
      return { conversation: after, changed: true };
    });
    const conv = result.conversation;
    if (result.changed) {
      await this.realtime.publish(this.event('conversation.updated', conv, 'public',
        { status: conv.status, category: conv.category }, { priority: conv.priority, version: conv.version }));
    }
    return this.db.asUser(access.userId, async (tx) => {
      const c = await tx.supportConversation.findUniqueOrThrow({
        where: { id: conv.id },
        include: { customer: { select: { id: true, email: true, displayName: true } }, assignee: { select: { user: { select: { id: true, displayName: true } } } } },
      });
      return this.staffView(c, (await this.staffUnread(tx, access.userId, [c.id])).get(c.id) ?? 0);
    });
  }

  assignmentHistory(access: StaffAccess, conversationId: string) {
    return this.db.asUser(access.userId, async (tx) => {
      const c = await this.visible(tx, { kind: 'staff', userId: access.userId, access }, conversationId);
      const rows = await tx.supportAssignment.findMany({
        where: { conversationId: c.id }, orderBy: { createdAt: 'asc' }, take: 500,
        include: {
          assignee: { select: { user: { select: { displayName: true } } } },
          previousAssignee: { select: { user: { select: { displayName: true } } } },
          assignedBy: { select: { displayName: true } },
        },
      });
      return {
        items: rows.map((r) => ({
          id: r.id, createdAt: r.createdAt, reason: r.reason,
          from: r.previousAssigneeUserId ? { userId: r.previousAssigneeUserId, displayName: r.previousAssignee?.user.displayName ?? null } : null,
          to: r.assigneeUserId ? { userId: r.assigneeUserId, displayName: r.assignee?.user.displayName ?? null } : null,
          by: { userId: r.assignedByUserId, displayName: r.assignedBy.displayName },
        })),
      };
    });
  }

  history(access: StaffAccess, conversationId: string) {
    if (!access.audit) throw Errors.forbidden();
    return this.db.asUser(access.userId, async (tx) => {
      const c = await this.visible(tx, { kind: 'staff', userId: access.userId, access }, conversationId);
      const rows = await tx.supportConversationEvent.findMany({
        where: { conversationId: c.id }, orderBy: { createdAt: 'asc' }, take: 1000, include: { actor: { select: { displayName: true } } },
      });
      return {
        items: rows.map((e) => ({
          id: e.id, type: e.type, createdAt: e.createdAt, data: e.data,
          actor: { kind: e.actorKind, userId: e.actorUserId, displayName: e.actor?.displayName ?? null },
        })),
      };
    });
  }

  metrics(access: StaffAccess) {
    if (!access.inbox) throw Errors.forbidden();
    return this.db.asUser(access.userId, async (tx) => {
      const byStatus = await tx.supportConversation.groupBy({ by: ['status'], _count: { _all: true } });
      const [queue] = await tx.$queryRaw<{ unassigned: number; oldest_unassigned_at: Date | null; urgent_open: number }[]>`
        SELECT count(*) FILTER (WHERE assignee_user_id IS NULL)::int AS unassigned,
               min(created_at) FILTER (WHERE assignee_user_id IS NULL) AS oldest_unassigned_at,
               count(*) FILTER (WHERE priority = 'URGENT')::int AS urgent_open
        FROM support_conversations WHERE status IN ('NEW', 'OPEN', 'PENDING_CUSTOMER', 'PENDING_SUPPORT')`;
      const perAssignee = await tx.supportConversation.groupBy({
        by: ['assigneeUserId'], where: { status: { in: ACTIVE_STATUSES }, assigneeUserId: { not: null } }, _count: { _all: true },
      });
      return {
        byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
        unassignedActive: queue?.unassigned ?? 0,
        oldestUnassignedWaitingSeconds: queue?.oldest_unassigned_at ? Math.floor((Date.now() - queue.oldest_unassigned_at.getTime()) / 1000) : null,
        urgentActive: queue?.urgent_open ?? 0,
        activePerAssignee: perAssignee.map((r) => ({ assigneeUserId: r.assigneeUserId, active: r._count._all })),
      };
    });
  }

  staffUnreadSummary(access: StaffAccess) {
    return this.db.asUser(access.userId, async (tx) => {
      const [row] = await tx.$queryRaw<{ conversations: number; messages: number }[]>`
        SELECT count(DISTINCT c.id)::int AS conversations, count(m.id)::int AS messages
        FROM support_conversations c
        LEFT JOIN support_read_markers r ON r.conversation_id = c.id AND r.user_id = ${access.userId}::uuid
        JOIN support_messages m ON m.conversation_id = c.id AND m.author_kind = 'CUSTOMER' AND m.seq > COALESCE(r.last_read_seq, 0)
        WHERE c.status <> 'CLOSED' AND (${access.inbox} OR c.assignee_user_id = ${access.userId}::uuid)`;
      return row ?? { conversations: 0, messages: 0 };
    });
  }

  /** Staff who can be assigned (holders of platform.support.assigned.access). */
  assignableStaff(access: StaffAccess) {
    if (!access.assign) throw Errors.forbidden();
    return this.db.asUser(access.userId, async (tx) => {
      const admins = await tx.platformAdmin.findMany({
        where: { status: 'ACTIVE', user: { status: 'ACTIVE' }, roles: { some: { role: { permissions: { some: { permissionKey: 'platform.support.assigned.access' } } } } } },
        select: { userId: true, user: { select: { displayName: true } } },
        orderBy: { userId: 'asc' }, take: 500,
      });
      return { items: admins.map((a) => ({ userId: a.userId, displayName: a.user.displayName })) };
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Locks the conversation row for this transaction (null if invisible to the caller under RLS). */
  async lock(tx: Tx, conversationId: string): Promise<LockedConversation | null> {
    const rows = await tx.$queryRaw<LockedConversation[]>`
      SELECT id, reference, customer_user_id, assignee_user_id, status::text AS status, version, message_seq, customer_read_seq,
             support_read_seq, customer_notified_seq, assignee_notified_seq
      FROM support_conversations WHERE id = ${conversationId}::uuid FOR UPDATE`;
    return rows[0] ?? null;
  }

  private lockedVisible(viewer: Viewer, c: LockedConversation): boolean {
    return viewer.kind === 'customer' ? c.customer_user_id === viewer.userId : staffCanSee(viewer.access, { assigneeUserId: c.assignee_user_id });
  }

  /** The conversation if the caller may use it through this route (customer route: own only). */
  async visible(tx: Tx, viewer: Viewer, conversationId: string): Promise<Conversation> {
    const c = await tx.supportConversation.findUnique({ where: { id: conversationId } });
    if (!c) throw notFound();
    const ok = viewer.kind === 'customer' ? c.customerUserId === viewer.userId : staffCanSee(viewer.access, c);
    if (!ok) throw notFound();
    return c;
  }

  private async ownConversation(tx: Tx, userId: string, conversationId: string) {
    return this.visible(tx, { kind: 'customer', userId }, conversationId);
  }

  private async upsertMarker(tx: Tx, conversationId: string, userId: string, seq: number): Promise<number> {
    const [row] = await tx.$queryRaw<{ last_read_seq: number }[]>`
      INSERT INTO support_read_markers (conversation_id, user_id, last_read_seq, updated_at)
      VALUES (${conversationId}::uuid, ${userId}::uuid, ${seq}, now())
      ON CONFLICT (conversation_id, user_id) DO UPDATE
        SET last_read_seq = GREATEST(support_read_markers.last_read_seq, EXCLUDED.last_read_seq), updated_at = now()
      RETURNING last_read_seq`;
    return row.last_read_seq;
  }

  private async customerUnread(tx: Tx, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await tx.$queryRaw<{ id: string; n: number }[]>`
      SELECT c.id, count(m.id)::int AS n FROM support_conversations c
      LEFT JOIN support_messages m ON m.conversation_id = c.id AND m.author_kind = 'STAFF' AND m.seq > c.customer_read_seq
      WHERE c.id = ANY(${ids}::uuid[]) GROUP BY c.id`;
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  private async staffUnread(tx: Tx, userId: string, ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await tx.$queryRaw<{ id: string; n: number }[]>`
      SELECT c.id, count(m.id)::int AS n FROM support_conversations c
      LEFT JOIN support_read_markers r ON r.conversation_id = c.id AND r.user_id = ${userId}::uuid
      LEFT JOIN support_messages m ON m.conversation_id = c.id AND m.author_kind = 'CUSTOMER' AND m.seq > COALESCE(r.last_read_seq, 0)
      WHERE c.id = ANY(${ids}::uuid[]) GROUP BY c.id`;
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  private assignmentSummary(access: StaffAccess, conversationId: string) {
    return this.db.asUser(access.userId, async (tx) => {
      const c = await tx.supportConversation.findUnique({
        where: { id: conversationId },
        include: { customer: { select: { id: true, email: true, displayName: true } }, assignee: { select: { user: { select: { id: true, displayName: true } } } } },
      });
      // After reassigning away, an assign-only administrator may no longer see it: report the outcome only.
      if (!c || !staffCanSee(access, c)) return { id: conversationId, assigneeUserId: c?.assigneeUserId ?? null };
      return this.staffView(c, (await this.staffUnread(tx, access.userId, [c.id])).get(c.id) ?? 0);
    });
  }

  private event(type: SupportEvent['type'], c: Conversation, audience: SupportEvent['audience'], data: Record<string, unknown>, staff?: Record<string, unknown>): SupportEvent {
    return { type, conversationId: c.id, customerUserId: c.customerUserId, assigneeUserId: c.assigneeUserId, audience, data, staff };
  }

  private viewFor(viewer: Viewer, c: Conversation) {
    return viewer.kind === 'customer' ? this.customerView(c, 0) : { id: c.id, status: c.status, version: c.version, messageSeq: c.messageSeq };
  }

  /** Customer-facing: no staff identities, assignment details, internal triage (priority) or counters. */
  customerView(c: Conversation, unreadCount: number) {
    return {
      id: c.id, reference: c.reference, subject: c.subject, category: c.category, status: c.status,
      assigned: c.assigneeUserId !== null, lastMessagePreview: c.lastMessagePreview, lastMessageAt: c.lastMessageAt,
      lastActivityAt: c.lastActivityAt, createdAt: c.createdAt, resolvedAt: c.resolvedAt, closedAt: c.closedAt,
      latestSeq: c.messageSeq, lastReadSeq: c.customerReadSeq, readBySupportUpToSeq: c.supportReadSeq, unreadCount,
    };
  }

  private staffSummary(c: Conversation) {
    return { id: c.id, reference: c.reference, subject: c.subject, category: c.category, priority: c.priority, status: c.status, createdAt: c.createdAt };
  }

  private staffView(
    c: Conversation & { customer: { id: string; email: string; displayName: string }; assignee: { user: { id: string; displayName: string } } | null },
    unreadCount: number,
  ) {
    return {
      id: c.id, reference: c.reference, subject: c.subject, category: c.category, priority: c.priority, status: c.status, version: c.version,
      customer: c.customer, organizationId: c.organizationId,
      assignee: c.assignee ? { userId: c.assignee.user.id, displayName: c.assignee.user.displayName } : null,
      lastMessagePreview: c.lastMessagePreview, lastMessageAt: c.lastMessageAt, lastActivityAt: c.lastActivityAt,
      createdAt: c.createdAt, resolvedAt: c.resolvedAt, closedAt: c.closedAt,
      latestSeq: c.messageSeq, customerReadSeq: c.customerReadSeq, supportReadSeq: c.supportReadSeq, unreadCount,
    };
  }

  private messageView(viewer: Viewer, m: MessageRow) {
    return viewer.kind === 'customer' ? this.customerMessageView(viewer.userId, m) : this.staffMessageView(m);
  }

  /** Customers never learn which staff member wrote a reply. */
  private customerMessageView(customerUserId: string, m: MessageRow) {
    return {
      id: m.id, seq: m.seq, authorKind: m.authorKind, body: m.body, createdAt: m.createdAt, attachments: m.attachments,
      mine: m.authorKind === 'CUSTOMER' && m.authorUserId === customerUserId,
    };
  }

  private staffMessageView(m: MessageRow) {
    return {
      id: m.id, seq: m.seq, authorKind: m.authorKind, body: m.body, createdAt: m.createdAt, attachments: m.attachments,
      author: { userId: m.authorUserId, displayName: m.author.displayName },
    };
  }

  private noteView(n: { id: string; body: string; authorUserId: string; createdAt: Date }) {
    return { id: n.id, body: n.body, authorUserId: n.authorUserId, createdAt: n.createdAt };
  }
}
