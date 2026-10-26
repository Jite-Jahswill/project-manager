import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanBackoffMs, unavailable } from './attachment-objects.service';
import { LocalObjectStore } from './local-object-store';
import { ClamAvScanner, parseScanReply, ScannerUnavailable } from './malware-scanner';
import { ObjectMissing, StorageUnavailable } from './object-store';

/** A fake clamd: decodes INSTREAM framing exactly and answers with `reply(bytes)`. */
function fakeClamd(reply: (data: Buffer) => string | null): Promise<{ server: Server; port: number; received: Buffer[] }> {
  const received: Buffer[] = [];
  const server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.toString('latin1').startsWith('zVERSION\0')) return void sock.end('ClamAV 1.4.6/28164/Mon Oct 26 07:00:00 2026\0');
      const header = 'zINSTREAM\0';
      if (!buf.toString('latin1').startsWith(header)) return;
      let off = header.length;
      const parts: Buffer[] = [];
      while (off + 4 <= buf.length) {
        const len = buf.readUInt32BE(off);
        if (len === 0) {
          const data = Buffer.concat(parts);
          received.push(data);
          const r = reply(data);
          if (r !== null) sock.end(`${r}\0`);
          return;
        }
        if (off + 4 + len > buf.length) return;
        parts.push(buf.subarray(off + 4, off + 4 + len));
        off += 4 + len;
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, received })));
}

describe('ClamAV client (INSTREAM protocol)', () => {
  it('streams the bytes in length-prefixed chunks and maps OK / FOUND to verdicts', async () => {
    const big = Buffer.alloc(200 * 1024, 7); // several 64 KiB chunks
    const clamd = await fakeClamd((d) => (d.includes(Buffer.from('EICAR')) ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK'));
    try {
      const scanner = new ClamAvScanner({ host: '127.0.0.1', port: clamd.port, timeoutMs: 2000 });
      expect(await scanner.scan(big)).toEqual({ clean: true, engine: 'ClamAV 1.4.6/28164' });
      expect(clamd.received[0].equals(big)).toBe(true);
      expect(await scanner.scan(Buffer.from('xx EICAR xx'))).toEqual({ clean: false, signature: 'Eicar-Test-Signature', engine: 'ClamAV 1.4.6/28164' });
    } finally {
      clamd.server.close();
    }
  });

  it('a silent or absent scanner is unavailable, never clean', async () => {
    const silent = await fakeClamd(() => null);
    try {
      await expect(new ClamAvScanner({ host: '127.0.0.1', port: silent.port, timeoutMs: 300 }).scan(Buffer.from('x'))).rejects.toBeInstanceOf(ScannerUnavailable);
    } finally {
      silent.server.close();
    }
    await expect(new ClamAvScanner({ host: '127.0.0.1', port: 1, timeoutMs: 300 }).scan(Buffer.from('x'))).rejects.toMatchObject({ reason: 'ECONNREFUSED' });
  });

  it('only "OK" is clean; errors and size limits are failures; signature names are sanitized', () => {
    expect(parseScanReply('stream: OK', 'e')).toEqual({ clean: true, engine: 'e' });
    expect(parseScanReply('stream: Win.Test.EICAR_HDB-1 FOUND', 'e')).toEqual({ clean: false, signature: 'Win.Test.EICAR_HDB-1', engine: 'e' });
    expect(parseScanReply('stream: <script>bad FOUND', 'e')).toEqual({ clean: false, signature: 'unknown-signature', engine: 'e' });
    expect(() => parseScanReply('INSTREAM size limit exceeded. ERROR', 'e')).toThrow(/size limit/);
    for (const r of ['', 'stream: ERROR', 'OK', 'stream: OK extra', 'UNKNOWN COMMAND']) expect(() => parseScanReply(r, 'e')).toThrow(ScannerUnavailable);
  });
});

describe('attachment lifecycle helpers', () => {
  it('retries back off exponentially to at most an hour', () => {
    expect([1, 2, 3, 4].map(scanBackoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(scanBackoffMs(30)).toBe(3_600_000);
  });

  it('every non-CLEAN state has a specific 409 that reveals no storage detail', () => {
    for (const [state, code] of [['UPLOADING', 'attachment_not_ready'], ['PENDING_SCAN', 'attachment_scan_pending'], ['SCAN_FAILED', 'attachment_scan_failed'],
      ['INFECTED', 'attachment_blocked'], ['ABANDONED', 'attachment_not_ready']] as const) {
      const e = unavailable(state);
      expect({ state, status: e.getStatus(), code: (e.getResponse() as { code: string }).code }).toEqual({ state, status: 409, code });
      expect(JSON.stringify(e.getResponse())).not.toMatch(/s3|bucket|key|path/i);
    }
  });
});

describe('local object store', () => {
  const root = mkdtempSync(join(tmpdir(), 'vd-store-'));
  const store = new LocalObjectStore(root);
  const k = 'finance/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';

  it('writes once, reads back, refuses overwrites and foreign keys, deletes idempotently', async () => {
    await store.put(k, Buffer.from('a'));
    expect((await store.get(k)).toString()).toBe('a');
    await expect(store.put(k, Buffer.from('b'))).rejects.toBeInstanceOf(StorageUnavailable);
    expect((await store.get(k)).toString()).toBe('a');
    for (const bad of ['../etc/passwd', 'support/../../x', 'other/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222']) {
      await expect(store.get(bad)).rejects.toThrow(/invalid storage key/);
    }
    await store.delete(k);
    await store.delete(k);
    await expect(store.get(k)).rejects.toBeInstanceOf(ObjectMissing);
  });
});
