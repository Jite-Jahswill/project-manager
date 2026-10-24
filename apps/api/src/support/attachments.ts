/**
 * Support attachment validation (docs/security/support.md §6).
 *
 * The declared Content-Type must be on the allowlist AND match the file's signature;
 * nothing is trusted from the client except the bytes themselves. Names are only used
 * in a Content-Disposition header, never to build a storage path.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain'] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];

export class AttachmentRejected extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

/** Detects the actual type from the content (magic numbers), or null. */
export function sniffType(buf: Buffer): AllowedType | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38]) && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) return 'image/gif';
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (isPlainText(buf)) return 'text/plain';
  return null;
}

/** Valid UTF-8 without NUL or other binary control characters (tab, LF, CR allowed). */
function isPlainText(buf: Buffer): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return false;
  }
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 127) return false;
  }
  return true;
}

/** Normalizes a declared MIME type ("Text/Plain; charset=utf-8" -> "text/plain"). */
export function normalizeContentType(raw: string | undefined): string {
  return (raw ?? '').split(';')[0].trim().toLowerCase();
}

export function validateAttachment(data: Buffer, declaredType: string | undefined): AllowedType {
  if (data.length === 0) throw new AttachmentRejected('attachment_empty', 'The file is empty');
  if (data.length > MAX_ATTACHMENT_BYTES) throw new AttachmentRejected('attachment_too_large', `Attachments are limited to ${MAX_ATTACHMENT_BYTES} bytes`);
  const declared = normalizeContentType(declaredType);
  if (!(ALLOWED_TYPES as readonly string[]).includes(declared)) {
    throw new AttachmentRejected('attachment_type_not_allowed', `Allowed types: ${ALLOWED_TYPES.join(', ')}`);
  }
  const actual = sniffType(data);
  if (actual !== declared) throw new AttachmentRejected('attachment_type_mismatch', 'The file content does not match its declared type');
  return actual;
}

/**
 * A display name safe to store and to put in a header: the last path segment only, no
 * control characters or separators, at most 200 characters (extension kept).
 */
export function sanitizeFileName(raw: string | undefined): string {
  let name = raw ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    /* use as received */
  }
  name = name.split(/[/\\]/).pop() ?? '';
  name = [...name].filter((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 32 && c !== 127 && !(c >= 0x80 && c <= 0x9f);
  }).join('').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!name) return 'attachment';
  if (name.length <= 200) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
  return name.slice(0, 200 - ext.length) + ext;
}

/** RFC 6266 attachment disposition with an ASCII fallback and an RFC 5987 UTF-8 name. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
