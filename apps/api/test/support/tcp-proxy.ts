import { createServer, Server, Socket, connect } from 'node:net';

/**
 * A TCP proxy in front of the real Redis, used to produce outages on demand:
 *   forward   - normal operation
 *   refuse    - listener closed and every connection dropped (connection refused / reset)
 *   blackhole - connections accepted, traffic silently dropped (a hung server: timeouts)
 */
export class TcpProxy {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  mode: 'forward' | 'blackhole' = 'forward';
  port = 0;

  constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
  ) {}

  async start(port = 0): Promise<number> {
    this.server = createServer((client) => {
      this.sockets.add(client);
      const upstream = connect(this.targetPort, this.targetHost);
      this.sockets.add(upstream);
      client.on('data', (d) => { if (this.mode === 'forward') upstream.write(d); });
      upstream.on('data', (d) => { if (this.mode === 'forward') client.write(d); });
      const close = () => { client.destroy(); upstream.destroy(); this.sockets.delete(client); this.sockets.delete(upstream); };
      client.on('close', close).on('error', close);
      upstream.on('close', close).on('error', close);
    });
    await new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
    this.port = (this.server.address() as { port: number }).port;
    return this.port;
  }

  /** Outage: refuse new connections and reset existing ones. */
  async refuse(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }

  /** Recovery after refuse(): listen again on the same port. */
  async resume(): Promise<void> {
    this.mode = 'forward';
    if (!this.server) await this.start(this.port);
  }

  async stop(): Promise<void> {
    await this.refuse();
  }
}

export function redisTarget(url: string): { host: string; port: number; password: string; db: string } {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379), password: decodeURIComponent(u.password), db: u.pathname.replace('/', '') || '0' };
}

export function redisUrlVia(proxyPort: number, url: string): string {
  const t = redisTarget(url);
  const auth = t.password ? `:${encodeURIComponent(t.password)}@` : '';
  return `redis://${auth}127.0.0.1:${proxyPort}/${t.db}`;
}

export async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 8000, stepMs = 50): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`condition not met within ${timeoutMs} ms`);
}
