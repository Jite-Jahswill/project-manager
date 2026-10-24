import { randomUUID } from 'node:crypto';
import { contentDisposition, MAX_ATTACHMENT_BYTES, sanitizeFileName, sniffType, validateAttachment, AttachmentRejected } from './attachments';
import { decodeCursor, encodeCursor } from './cursor';
import {
  canTransition, ConversationClosedError, customerMayReopen, previewOf, statusAfterCustomerMessage, statusAfterStaffReply, SUPPORT_STATUSES,
} from './lifecycle';
import { staffAccessFrom, staffCanSee } from './support-access';
import { deliverableTo, SupportEvent, StreamViewer } from './support-realtime.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1');

describe('support lifecycle', () => {
  it('closed is terminal; resolved can be reopened; every status can stay as it is', () => {
    for (const s of SUPPORT_STATUSES) expect(canTransition(s, s)).toBe(true);
    for (const s of SUPPORT_STATUSES.filter((x) => x !== 'CLOSED')) expect(canTransition('CLOSED', s)).toBe(false);
    expect(canTransition('RESOLVED', 'PENDING_SUPPORT')).toBe(true);
    expect(canTransition('OPEN', 'NEW')).toBe(false);
  });

  it('customer replies hand the conversation back to support and reopen resolved ones; closed refuses', () => {
    expect(statusAfterCustomerMessage('NEW')).toBe('NEW');
    expect(statusAfterCustomerMessage('PENDING_CUSTOMER')).toBe('PENDING_SUPPORT');
    expect(statusAfterCustomerMessage('RESOLVED')).toBe('PENDING_SUPPORT');
    expect(() => statusAfterCustomerMessage('CLOSED')).toThrow(ConversationClosedError);
    expect(statusAfterStaffReply('PENDING_SUPPORT')).toBe('PENDING_CUSTOMER');
    expect(() => statusAfterStaffReply('CLOSED')).toThrow(ConversationClosedError);
    expect(customerMayReopen('RESOLVED')).toBe(true);
    expect(customerMayReopen('CLOSED')).toBe(false);
    expect(customerMayReopen('OPEN')).toBe(false);
  });

  it('previews are single-line and bounded', () => {
    expect(previewOf('  hello\n\nworld  ')).toBe('hello world');
    const long = previewOf('x'.repeat(500));
    expect(long.length).toBe(140);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('support cursors', () => {
  it('round-trips and rejects tampering', () => {
    const c = { at: new Date('2026-10-24T10:00:00.123Z'), id: randomUUID() };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(undefined)).toBeNull();
    expect(() => decodeCursor('not-a-cursor')).toThrow(/cursor/);
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ t: 'x', i: "1' OR 1=1" })).toString('base64url'))).toThrow(/cursor/);
  });
});

describe('support attachments', () => {
  it('detects types from content, not from the declared type', () => {
    expect(sniffType(PNG)).toBe('image/png');
    expect(sniffType(PDF)).toBe('application/pdf');
    expect(sniffType(Buffer.from('plain text\nok'))).toBe('text/plain');
    expect(sniffType(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // Windows executable
    expect(sniffType(Buffer.from('<svg onload=alert(1)>'))).toBe('text/plain'); // stored as inert text, never as image/svg+xml
  });

  it.each([
    ['an executable declared as PDF', Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'application/pdf', 'attachment_type_mismatch'],
    ['HTML declared as an image', Buffer.from('<html><script>x</script></html>'), 'image/png', 'attachment_type_mismatch'],
    ['a disallowed type', Buffer.from('<svg/>'), 'image/svg+xml', 'attachment_type_not_allowed'],
    ['HTML declared as HTML', Buffer.from('<html></html>'), 'text/html', 'attachment_type_not_allowed'],
    ['an empty file', Buffer.alloc(0), 'text/plain', 'attachment_empty'],
    ['binary declared as text', Buffer.from([0x00, 0x01, 0x02]), 'text/plain', 'attachment_type_mismatch'],
    ['an oversized file', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x41), 'text/plain', 'attachment_too_large'],
  ])('rejects %s', (_label, data, type, code) => {
    expect(() => validateAttachment(data, type)).toThrow(AttachmentRejected);
    try {
      validateAttachment(data, type);
    } catch (e) {
      expect((e as AttachmentRejected).code).toBe(code);
    }
  });

  it('accepts matching content with parameters in the declared type', () => {
    expect(validateAttachment(Buffer.from('hello'), 'Text/Plain; charset=utf-8')).toBe('text/plain');
    expect(validateAttachment(PNG, 'image/png')).toBe('image/png');
  });

  it('sanitizes names: last segment only, no control characters, bounded, never empty', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('..\\..\\boot.ini')).toBe('boot.ini');
    expect(sanitizeFileName('%2E%2E%2Fsecret.txt')).toBe('secret.txt');
    expect(sanitizeFileName('a\r\nSet-Cookie: x.txt')).toBe('aSet-Cookie: x.txt');
    expect(sanitizeFileName('.htaccess')).toBe('htaccess');
    expect(sanitizeFileName('')).toBe('attachment');
    expect(sanitizeFileName(undefined)).toBe('attachment');
    const long = sanitizeFileName(`${'n'.repeat(300)}.pdf`);
    expect(long.length).toBe(200);
    expect(long.endsWith('.pdf')).toBe(true);
  });

  it('builds a header-safe Content-Disposition', () => {
    const h = contentDisposition('rapport "final" é.pdf');
    expect(h).toBe(`attachment; filename="rapport _final_ _.pdf"; filename*=UTF-8''${encodeURIComponent('rapport "final" é.pdf')}`);
    expect(h).not.toMatch(/[\r\n]/);
  });
});

describe('support access and real-time filtering', () => {
  const customerId = randomUUID();
  const agentId = randomUUID();
  const otherAgentId = randomUUID();
  const adminId = randomUUID();
  const agent = staffAccessFrom(agentId, new Set(['platform.support.assigned.access', 'platform.support.reply']));
  const admin = staffAccessFrom(adminId, new Set(['platform.support.inbox.read', 'platform.support.notes']));
  const viewers: Record<string, StreamViewer> = {
    customer: { kind: 'customer', userId: customerId, sessionId: 's1' },
    otherCustomer: { kind: 'customer', userId: randomUUID(), sessionId: 's2' },
    agent: { kind: 'staff', userId: agentId, sessionId: 's3', access: agent },
    otherAgent: { kind: 'staff', userId: otherAgentId, sessionId: 's4', access: staffAccessFrom(otherAgentId, new Set(['platform.support.assigned.access'])) },
    admin: { kind: 'staff', userId: adminId, sessionId: 's5', access: admin },
  };
  const base = { conversationId: randomUUID(), customerUserId: customerId, assigneeUserId: agentId };
  const who = (e: SupportEvent) => Object.entries(viewers).filter(([, v]) => deliverableTo(v, e) !== null).map(([k]) => k).sort();

  it('staff visibility: inbox sees all, agents only their assignments', () => {
    expect(staffCanSee(agent, { assigneeUserId: agentId })).toBe(true);
    expect(staffCanSee(agent, { assigneeUserId: null })).toBe(false);
    expect(staffCanSee(admin, { assigneeUserId: null })).toBe(true);
  });

  it('public messages reach the customer, inbox staff and the assigned agent only; staff identity stays out of the customer copy', () => {
    const e: SupportEvent = { ...base, type: 'message.created', audience: 'public', data: { body: 'hi' }, staff: { author: 'Agent Smith' } };
    expect(who(e)).toEqual(['admin', 'agent', 'customer']);
    expect(deliverableTo(viewers.customer, e)).not.toHaveProperty('author');
    expect(deliverableTo(viewers.agent, e)).toHaveProperty('author');
  });

  it('internal-note events never reach a customer stream, and need the notes capability', () => {
    const e: SupportEvent = { ...base, type: 'note.created', audience: 'staff', requires: 'notes', data: { noteId: 'n' } };
    expect(who(e)).toEqual(['admin']);
  });

  it('after reassignment the previous agent learns only that access ended', () => {
    const e: SupportEvent = {
      ...base, assigneeUserId: otherAgentId, previousAssigneeUserId: agentId, type: 'conversation.assigned', audience: 'public',
      data: { assigned: true }, staff: { assigneeUserId: otherAgentId },
    };
    expect(who(e)).toEqual(['admin', 'agent', 'customer', 'otherAgent']);
    expect(deliverableTo(viewers.agent, e)).toEqual({ conversationId: base.conversationId, access: 'revoked' });
  });

  it('"self" events reach only the target user', () => {
    const e: SupportEvent = { ...base, type: 'read.updated', audience: 'self', targetUserId: customerId, data: { lastReadSeq: 3 } };
    expect(who(e)).toEqual(['customer']);
  });
});
