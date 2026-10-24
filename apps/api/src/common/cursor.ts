import { Errors } from './errors';

/**
 * Opaque keyset cursor for conversation lists: (sort timestamp, id) of the last item
 * returned. Stable under concurrent inserts, unlike offsets. Clients must not parse it.
 */
export interface Cursor {
  at: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ t: c.at.toISOString(), i: c.id })).toString('base64url');
}

export function decodeCursor(raw: string | undefined): Cursor | null {
  if (raw === undefined || raw === '') return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { t?: unknown; i?: unknown };
    const at = typeof v.t === 'string' ? new Date(v.t) : null;
    if (!at || Number.isNaN(at.getTime()) || typeof v.i !== 'string' || !UUID.test(v.i)) throw new Error('shape');
    return { at, id: v.i };
  } catch {
    throw Errors.badRequest('invalid_cursor', 'The pagination cursor is invalid');
  }
}

/**
 * Escapes LIKE/ILIKE metacharacters so user input matches literally (PostgreSQL's default
 * escape character is the backslash). Prisma's `contains`/`startsWith` do NOT escape them.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Keyset cursor on a text sort key (e.g. a name) plus the row id as tie-breaker. */
export interface KeyCursor {
  key: string;
  id: string;
}

export function encodeKeyCursor(c: KeyCursor): string {
  return Buffer.from(JSON.stringify({ k: c.key, i: c.id })).toString('base64url');
}

export function decodeKeyCursor(raw: string | undefined): KeyCursor | null {
  if (raw === undefined || raw === '') return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { k?: unknown; i?: unknown };
    if (typeof v.k !== 'string' || v.k.length > 400 || typeof v.i !== 'string' || !UUID.test(v.i)) throw new Error('shape');
    return { key: v.k, id: v.i };
  } catch {
    throw Errors.badRequest('invalid_cursor', 'The pagination cursor is invalid');
  }
}
