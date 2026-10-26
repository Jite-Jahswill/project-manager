import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AuditService } from '../audit/audit.service';
import { ApiError, Errors } from '../common/errors';
import type { RequestMeta } from '../common/request-context';
import { TenantDb } from '../database/tenant-db.service';
import { AttachmentObjects } from '../storage/attachment-objects.service';
import { AttachmentRejected, MAX_ATTACHMENT_BYTES, sanitizeFileName, validateAttachment } from './attachments';
import { staffCanSee } from './support-access';
import { SupportService, Viewer } from './support.service';

/**
 * Reads a raw upload body with a hard byte limit. Bodies are never parsed (no multipart):
 * the client sends the file bytes with Content-Type and X-File-Name headers.
 */
export async function readUpload(req: IncomingMessage, maxBytes = MAX_ATTACHMENT_BYTES): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) throw tooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const tooLarge = () => new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, 'attachment_too_large', `Attachments are limited to ${MAX_ATTACHMENT_BYTES} bytes`);

@Injectable()
export class SupportAttachmentsService {
  constructor(
    private readonly db: TenantDb,
    private readonly objects: AttachmentObjects,
    private readonly audit: AuditService,
    private readonly support: SupportService,
  ) {}

  async upload(viewer: Viewer, conversationId: string, data: Buffer, declaredType: string | undefined, rawName: string | undefined, meta: RequestMeta) {
    if (viewer.kind === 'staff' && !viewer.access.reply) throw Errors.forbidden();
    let contentType: string;
    try {
      contentType = validateAttachment(data, declaredType);
    } catch (e) {
      if (!(e instanceof AttachmentRejected)) throw e;
      const status = e.code === 'attachment_too_large' ? HttpStatus.PAYLOAD_TOO_LARGE
        : e.code === 'attachment_empty' ? HttpStatus.BAD_REQUEST : HttpStatus.UNSUPPORTED_MEDIA_TYPE;
      throw new ApiError(status, e.code, e.message);
    }
    // Authorize before anything is stored.
    const conversation = await this.db.asUser(viewer.userId, (tx) => this.support.visible(tx, viewer, conversationId));
    if (conversation.status === 'CLOSED') throw Errors.conflict('conversation_closed', 'This conversation is closed');

    const id = randomUUID();
    // Server-generated key only: nothing from the client reaches the storage path.
    const storageKey = `support/${conversation.id}/${id}`;
    const fileName = sanitizeFileName(rawName);
    const sha256 = createHash('sha256').update(data).digest('hex');
    // The object row (UPLOADING) commits with the attachment row before any bytes are written,
    // so an interrupted upload is always found and cleaned up (docs/security/attachments.md §3).
    const row = await this.db.asUser(viewer.userId, async (tx) => {
      await this.objects.register(tx, { id, domain: 'support', storageKey, contentType, data, sha256 });
      const created = await tx.supportAttachment.create({
        data: {
          id, conversationId: conversation.id, uploaderUserId: viewer.userId, uploaderKind: viewer.kind === 'customer' ? 'CUSTOMER' : 'STAFF',
          storageKey, fileName, contentType, sizeBytes: data.length, sha256,
        },
        select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
      });
      await this.audit.record(tx, {
        action: viewer.kind === 'staff' ? 'platform.support.attachment.uploaded' : 'support.attachment.uploaded',
        resourceType: 'support_attachment', resourceId: id, actorType: viewer.kind === 'staff' ? 'PLATFORM_ADMIN' : 'USER',
        actorUserId: viewer.userId, metadata: { conversationId: conversation.id, contentType, sizeBytes: data.length },
      }, meta);
      return created;
    });
    const scanStatus = await this.objects.storeAndScan(id, storageKey, data, sha256);
    return { ...row, scanStatus };
  }

  async download(viewer: Viewer, attachmentId: string, meta: RequestMeta) {
    const a = await this.db.asUser(viewer.userId, async (tx) => {
      const row = await tx.supportAttachment.findUnique({
        where: { id: attachmentId },
        include: {
          conversation: { select: { customerUserId: true, assigneeUserId: true } },
          object: { select: { id: true, state: true, backend: true, storageKey: true, sha256: true, sizeBytes: true } },
        },
      });
      if (!row) throw Errors.notFound('Attachment');
      const allowed = viewer.kind === 'customer'
        ? row.conversation.customerUserId === viewer.userId && (row.uploaderUserId === viewer.userId || row.messageId !== null)
        : viewer.access.attachments && staffCanSee(viewer.access, row.conversation);
      if (!allowed) throw Errors.notFound('Attachment');
      if (viewer.kind === 'staff') {
        await this.audit.record(tx, {
          action: 'platform.support.attachment.downloaded', resourceType: 'support_attachment', resourceId: row.id,
          actorType: 'PLATFORM_ADMIN', actorUserId: viewer.userId, metadata: { conversationId: row.conversationId },
        }, meta);
      }
      return row;
    });
    // Served only when scanned CLEAN, and only if the bytes still match the recorded SHA-256.
    const data = await this.objects.readVerified(a.object);
    return { fileName: a.fileName, contentType: a.contentType, data };
  }
}
