import { Errors } from '../common/errors';

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
