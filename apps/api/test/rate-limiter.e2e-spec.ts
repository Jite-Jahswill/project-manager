/**
 * The shared limiter against a REAL Redis (TEST_REDIS_URL): distribution across
 * independent instances, atomicity, expiry, key hygiene, and failure/recovery
 * behavior through a TCP proxy that produces outages and hangs on demand.
 */
import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config/env';
import { RateLimiter, RateLimiterUnavailableError, RateLimitError } from '../src/abuse/rate-limiter.service';
import { RedisService } from '../src/abuse/redis.service';
import { redisTarget, redisUrlVia, TcpProxy, waitFor } from './support/tcp-proxy';

type Instance = { redis: RedisService; limiter: RateLimiter };

describe('Shared rate limiter (real Redis)', () => {
  const created: Instance[] = [];
  let raw: Redis;

  /** An independent limiter "instance" = its own Redis connection, as a separate API process would have. */
  function instance(env: Record<string, string> = {}): Instance {
    const config = loadConfig({ ...process.env, ...env });
    const redis = new RedisService(config);
    const limiter = new RateLimiter(config, redis);
    created.push({ redis, limiter });
    return { redis, limiter };
  }

  const ready = (i: Instance) => waitFor(() => i.redis.ready);

  beforeAll(() => {
    raw = new Redis(process.env.REDIS_URL as string);
  });

  afterAll(async () => {
    for (const i of created) await i.redis.onApplicationShutdown();
    raw.disconnect();
  });

  const prefix = () => `t${randomBytes(6).toString('hex')}`;

  it('enforces one limit across independent instances sharing Redis', async () => {
    const p = prefix();
    const env = { RATE_LIMIT_KEY_PREFIX: p, RATE_LIMIT_OVERRIDES: 'login.ip=5/1m' };
    const a = instance(env);
    const b = instance(env);
    await Promise.all([ready(a), ready(b)]);
    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) results.push((await (i % 2 ? b : a).limiter.consume('login.ip', 'ip:198.51.100.1')).allowed);
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(results.slice(0, 5)).toEqual([true, true, true, true, true]);
    // A different prefix (e.g. another environment) does not share the bucket.
    const other = instance({ RATE_LIMIT_KEY_PREFIX: prefix(), RATE_LIMIT_OVERRIDES: 'login.ip=5/1m' });
    await ready(other);
    expect((await other.limiter.consume('login.ip', 'ip:198.51.100.1')).allowed).toBe(true);
  });

  it('is atomic under heavy concurrency from many instances', async () => {
    const env = { RATE_LIMIT_KEY_PREFIX: prefix(), RATE_LIMIT_OVERRIDES: 'login.ip=50/1h' };
    const instances = [instance(env), instance(env), instance(env), instance(env)];
    await Promise.all(instances.map(ready));
    const decisions = await Promise.all(
      Array.from({ length: 400 }, (_, i) => instances[i % 4].limiter.consume('login.ip', 'ip:concurrent')),
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(50);
    for (const d of decisions.filter((x) => !x.allowed)) expect(d.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills over time and resets fully after the window (GCRA)', async () => {
    const i = instance({ RATE_LIMIT_KEY_PREFIX: prefix(), RATE_LIMIT_OVERRIDES: 'login.ip=3/600ms' });
    await ready(i);
    const s = 'ip:refill';
    for (let n = 0; n < 3; n++) expect((await i.limiter.consume('login.ip', s)).allowed).toBe(true);
    const denied = await i.limiter.consume('login.ip', s);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(200); // one token every 600/3 ms
    await new Promise((r) => setTimeout(r, denied.retryAfterMs + 30));
    expect((await i.limiter.consume('login.ip', s)).allowed).toBe(true); // exactly one refilled
    expect((await i.limiter.consume('login.ip', s)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 650));
    for (let n = 0; n < 3; n++) expect((await i.limiter.consume('login.ip', s)).allowed).toBe(true); // full burst again
  });

  it('refund returns exactly one reservation and can never credit beyond a full bucket', async () => {
    const i = instance({ RATE_LIMIT_KEY_PREFIX: prefix(), RATE_LIMIT_OVERRIDES: 'login.ip=3/1h' });
    await ready(i);
    // Refunds on an idle bucket are no-ops: still exactly 3 allowed afterwards.
    for (let n = 0; n < 5; n++) await i.limiter.refund('login.ip', 'ip:idle');
    const idle = [];
    for (let n = 0; n < 4; n++) idle.push((await i.limiter.consume('login.ip', 'ip:idle')).allowed);
    expect(idle).toEqual([true, true, true, false]);
    // One refund = exactly one more attempt.
    await i.limiter.refund('login.ip', 'ip:idle');
    expect((await i.limiter.consume('login.ip', 'ip:idle')).allowed).toBe(true);
    expect((await i.limiter.consume('login.ip', 'ip:idle')).allowed).toBe(false);
  });

  it('concurrent consume/refund pairs from many instances leave the bucket intact', async () => {
    const env = { RATE_LIMIT_KEY_PREFIX: prefix(), RATE_LIMIT_OVERRIDES: 'login.ip=10/1h' };
    const xs = [instance(env), instance(env), instance(env)];
    await Promise.all(xs.map(ready));
    // 200 "successful logins": each reserves then refunds.
    await Promise.all(Array.from({ length: 200 }, async (_, k) => {
      const l = xs[k % 3].limiter;
      if ((await l.consume('login.ip', 'ip:pairs')).allowed) await l.refund('login.ip', 'ip:pairs');
    }));
    const after = [];
    for (let n = 0; n < 11; n++) after.push((await xs[n % 3].limiter.consume('login.ip', 'ip:pairs')).allowed);
    expect(after.filter(Boolean)).toHaveLength(10);
  });

  it('stores bounded, expiring keys with no raw identifiers', async () => {
    const p = prefix();
    const i = instance({ RATE_LIMIT_KEY_PREFIX: p, RATE_LIMIT_OVERRIDES: 'forgot.email=3/1h' });
    await ready(i);
    const subject = 'email:victim.person@example.test';
    await i.limiter.consume('forgot.email', subject);
    const keys = await raw.keys(`${p}:*`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(new RegExp(`^${p}:rl:forgot\\.email:[0-9a-f]{32}$`));
    expect(keys[0]).not.toContain('victim');
    const value = await raw.get(keys[0]);
    expect(value).toMatch(/^\d+\.\d{3}$/); // a timestamp, nothing else
    const ttl = await raw.pttl(keys[0]);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(20 * 60_000 + 50); // one emission interval (1h/3) at most
    await i.limiter.reset('forgot.email', subject);
    expect(await raw.exists(keys[0])).toBe(0);
  });

  describe('Redis failures', () => {
    const target = redisTarget(process.env.REDIS_URL as string);
    let proxy: TcpProxy;
    let viaProxy: Instance;

    beforeEach(async () => {
      proxy = new TcpProxy(target.host, target.port);
      const port = await proxy.start();
      viaProxy = instance({
        REDIS_URL: redisUrlVia(port, process.env.REDIS_URL as string),
        RATE_LIMIT_KEY_PREFIX: prefix(),
        RATE_LIMIT_OVERRIDES: 'login.ip=100/1m,default.ip=100/1m',
        REDIS_COMMAND_TIMEOUT_MS: '200',
      });
      await ready(viaProxy);
    });

    afterEach(async () => {
      await proxy.stop();
    });

    it('connection failure: fails fast, closed policies refuse, open policies allow', async () => {
      await proxy.refuse();
      await waitFor(() => !viaProxy.redis.ready);
      const t0 = Date.now();
      await expect(viaProxy.limiter.consume('login.ip', 'ip:x')).rejects.toBeInstanceOf(RateLimiterUnavailableError);
      await expect(viaProxy.limiter.enforce('login.ip', 'ip:x')).rejects.toMatchObject({ retryAfterSeconds: 5 });
      await expect(viaProxy.limiter.enforce('login.ip', 'ip:x')).rejects.toBeInstanceOf(RateLimitError);
      const closed = await viaProxy.limiter.enforce('login.ip', 'ip:x').catch((e: RateLimitError) => e.getStatus());
      expect(closed).toBe(503);
      await expect(viaProxy.limiter.enforce('default.ip', 'ip:x')).resolves.toBeUndefined(); // fail-open policy
      expect(Date.now() - t0).toBeLessThan(200); // no waiting on a dead connection
    });

    it('timeout: a hung Redis is bounded by the command timeout, then the circuit fails fast', async () => {
      proxy.mode = 'blackhole';
      const t0 = Date.now();
      await expect(viaProxy.limiter.consume('login.ip', 'ip:hang')).rejects.toBeInstanceOf(RateLimiterUnavailableError);
      const first = Date.now() - t0;
      expect(first).toBeGreaterThanOrEqual(150);
      expect(first).toBeLessThan(1000);
      const t1 = Date.now();
      await expect(viaProxy.limiter.consume('login.ip', 'ip:hang')).rejects.toBeInstanceOf(RateLimiterUnavailableError);
      expect(Date.now() - t1).toBeLessThan(50); // circuit open: no second timeout
      expect(viaProxy.limiter.stats().circuitOpen).toBe(true);
    });

    it('does not queue or pile up work during an outage', async () => {
      await proxy.refuse();
      await waitFor(() => !viaProxy.redis.ready);
      const t0 = Date.now();
      const results = await Promise.allSettled(Array.from({ length: 1000 }, () => viaProxy.limiter.consume('login.ip', 'ip:storm')));
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      expect(Date.now() - t0).toBeLessThan(500);
    });

    it('recovers distributed enforcement automatically when Redis returns', async () => {
      await proxy.refuse();
      await waitFor(() => !viaProxy.redis.ready);
      await expect(viaProxy.limiter.consume('login.ip', 'ip:r')).rejects.toBeInstanceOf(RateLimiterUnavailableError);
      await proxy.resume();
      await waitFor(() => viaProxy.redis.ready, 8000);
      await waitFor(async () => (await viaProxy.limiter.consume('login.ip', 'ip:r').then(() => true, () => false)), 3000);
      // Enforcement is real again: the bucket counts.
      const decisions = [];
      for (let n = 0; n < 101; n++) decisions.push(await viaProxy.limiter.consume('login.ip', 'ip:r2'));
      expect(decisions.filter((d) => d.allowed)).toHaveLength(100);
      expect(decisions[100].allowed).toBe(false);
    });
  });
});
