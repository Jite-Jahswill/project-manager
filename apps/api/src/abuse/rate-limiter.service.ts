import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, hkdfSync } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import { ApiError } from '../common/errors';
import { PolicyName, RateLimitPolicy } from './policies';
import { RedisService } from './redis.service';

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until one more request would be allowed (0 when allowed). */
  retryAfterMs: number;
  remaining: number;
}

/** The shared limiter could not be consulted (Redis down, timed out, circuit open). */
/** Why the shared limiter could not be consulted (diagnostics only; never sent to clients). */
export type UnavailableReason = 'circuit_open' | 'not_ready' | 'timeout' | 'connection_error' | 'redis_error';

export class RateLimiterUnavailableError extends Error {
  constructor(message: string, readonly reason: UnavailableReason = 'redis_error', readonly elapsedMs = 0) {
    super(message);
    this.name = 'RateLimiterUnavailableError';
  }
}

/** Classifies a failed Redis call. ioredis' commandTimeout rejects with "Command timed out". */
export function classifyRedisFailure(e: unknown): UnavailableReason {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timed out/i.test(msg)) return 'timeout';
  if (/ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|EHOSTUNREACH|Connection is closed|Stream isn't writeable|enableOfflineQueue/i.test(msg)) return 'connection_error';
  return 'redis_error';
}

/**
 * GCRA (token bucket) in one atomic Lua script. Redis TIME is the only clock, so
 * all API instances agree. The key holds the "theoretical arrival time" and
 * expires exactly when the bucket is full again.
 *
 * KEYS[1] bucket   ARGV[1] emission interval ms   ARGV[2] burst (= limit)   ARGV[3] cost
 * returns { allowed(0|1), retry_after_ms, remaining }
 */
const GCRA_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local interval = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
if tat < now then tat = now end
local new_tat = tat + interval * cost
local allow_at = new_tat - interval * burst
if allow_at > now then
  return {0, math.ceil(allow_at - now), 0}
end
redis.call('SET', KEYS[1], string.format('%.3f', new_tat), 'PX', math.max(1, math.ceil(new_tat - now)))
return {1, 0, math.floor((now - allow_at) / interval)}
`;

/**
 * Gives back `cost` previously consumed (a reservation that turned out legitimate).
 * Never credits beyond a full bucket: a refund on an idle bucket is a no-op.
 * KEYS[1] bucket   ARGV[1] emission interval ms   ARGV[2] cost
 */
const GCRA_REFUND_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local tat = tonumber(redis.call('GET', KEYS[1]) or '0')
if tat <= now then return 0 end
local new_tat = tat - tonumber(ARGV[1]) * tonumber(ARGV[2])
if new_tat <= now then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], string.format('%.3f', new_tat), 'PX', math.max(1, math.ceil(new_tat - now)))
end
return 1
`;

type GcraRedis = {
  vdGcra(key: string, interval: string, burst: string, cost: string): Promise<[number, number, number]>;
  vdGcraRefund(key: string, interval: string, cost: string): Promise<number>;
};

const CIRCUIT_OPEN_MS = 1000;

@Injectable()
export class RateLimiter {
  private readonly logger = new Logger('RateLimiter');
  private readonly keySecret: Buffer;
  private circuitOpenUntil = 0;
  private readonly counters = { allowed: 0, limited: 0, unavailable: 0 };
  /** Unavailable outcomes by cause, and the last one (diagnostics for incidents such as unexpected 503s). */
  private readonly unavailableByReason: Record<UnavailableReason, number> = { circuit_open: 0, not_ready: 0, timeout: 0, connection_error: 0, redis_error: 0 };
  private lastUnavailable: { reason: UnavailableReason; at: string; elapsedMs: number; redisStatus: string } | null = null;
  private lastUnavailableLog = 0;
  private suppressedUnavailable = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {
    this.keySecret = Buffer.from(hkdfSync('sha256', config.abuseProtectionSecret, 'ventidoc', 'rate-limit-key', 32));
    redis.client.defineCommand('vdGcra', { numberOfKeys: 1, lua: GCRA_LUA });
    redis.client.defineCommand('vdGcraRefund', { numberOfKeys: 1, lua: GCRA_REFUND_LUA });
  }

  policy(name: PolicyName): RateLimitPolicy {
    return this.config.rateLimitPolicies[name];
  }

  /**
   * Bucket key. The subject (email, IP network, user ID, ...) is HMAC'd: Redis never
   * holds raw identifiers, and keys have a fixed, bounded length.
   */
  key(name: PolicyName, subject: string): string {
    const digest = createHmac('sha256', this.keySecret).update(`${name}\0${subject}`).digest('hex').slice(0, 32);
    return `${this.config.rateLimitKeyPrefix}:rl:${name}:${digest}`;
  }

  /** Consumes `cost` from the bucket. Throws RateLimiterUnavailableError if Redis cannot be consulted. */
  async consume(name: PolicyName, subject: string, cost = 1): Promise<RateLimitDecision> {
    const p = this.policy(name);
    const [allowed, retryAfterMs, remaining] = await this.call(() =>
      (this.redis.client as unknown as GcraRedis).vdGcra(this.key(name, subject), String(p.periodMs / p.limit), String(p.limit), String(cost)),
    );
    if (allowed === 1) this.counters.allowed++;
    else this.counters.limited++;
    return { allowed: allowed === 1, retryAfterMs: Number(retryAfterMs), remaining: Number(remaining) };
  }

  /**
   * Returns a reservation made with consume()/enforce() (e.g. an attempt that turned
   * out to be a successful login). Best effort: never throws.
   */
  async refund(name: PolicyName, subject: string, cost = 1): Promise<void> {
    const p = this.policy(name);
    await this.call(() =>
      (this.redis.client as unknown as GcraRedis).vdGcraRefund(this.key(name, subject), String(p.periodMs / p.limit), String(cost)),
    ).catch(() => undefined);
  }

  /** Clears a bucket (e.g. the per-account bucket after a password reset). */
  async reset(name: PolicyName, subject: string): Promise<void> {
    await this.call(() => this.redis.client.del(this.key(name, subject)));
  }

  /**
   * Consumes and turns the decision into an HTTP outcome:
   *  - limited                     -> 429 rate_limited + Retry-After
   *  - unavailable, policy closed  -> 503 temporarily_unavailable + Retry-After
   *  - unavailable, policy open    -> allowed (logged)
   */
  async enforce(name: PolicyName, subject: string, cost = 1): Promise<void> {
    let decision: RateLimitDecision;
    try {
      decision = await this.consume(name, subject, cost);
    } catch (e) {
      if (!(e instanceof RateLimiterUnavailableError)) throw e;
      const mode = this.policy(name).onRedisFailure;
      this.logUnavailable(name, mode, e);
      if (mode === 'open') return;
      throw new RateLimitError(HttpStatus.SERVICE_UNAVAILABLE, 'temporarily_unavailable', 'Temporarily unavailable. Try again shortly.', 5);
    }
    if (!decision.allowed) {
      throw new RateLimitError(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', 'Too many requests. Try again later.', Math.max(1, Math.ceil(decision.retryAfterMs / 1000)));
    }
  }

  stats() {
    return {
      ...this.counters, circuitOpen: Date.now() < this.circuitOpenUntil,
      unavailableByReason: { ...this.unavailableByReason }, lastUnavailable: this.lastUnavailable,
    };
  }

  private unavailable(reason: UnavailableReason, elapsedMs: number, message: string): RateLimiterUnavailableError {
    this.counters.unavailable++;
    this.unavailableByReason[reason]++;
    this.lastUnavailable = { reason, at: new Date().toISOString(), elapsedMs, redisStatus: this.redis.client.status };
    return new RateLimiterUnavailableError(message, reason, elapsedMs);
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    if (Date.now() < this.circuitOpenUntil) throw this.unavailable('circuit_open', 0, 'rate limiter unavailable (circuit open)');
    if (!this.redis.ready) throw this.unavailable('not_ready', 0, 'rate limiter unavailable (redis not ready)');
    const started = Date.now();
    try {
      return await fn();
    } catch (e) {
      // Fail fast for a short while instead of making every request wait for a timeout.
      this.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      throw this.unavailable(classifyRedisFailure(e), Date.now() - started, e instanceof Error ? e.message : 'redis error');
    }
  }

  /**
   * Structured and redacted: the policy, failure mode, cause, elapsed time and connection
   * state. Never the subject, the bucket key or request data.
   */
  private logUnavailable(policy: PolicyName, mode: string, e: RateLimiterUnavailableError): void {
    const now = Date.now();
    if (now - this.lastUnavailableLog < 10_000) {
      this.suppressedUnavailable++;
      return;
    }
    this.logger.warn(JSON.stringify({
      event: 'rate_limit.redis_unavailable', policy, mode, reason: e.reason, elapsedMs: e.elapsedMs,
      redisStatus: this.redis.client.status, commandTimeoutMs: this.config.redisCommandTimeoutMs, suppressed: this.suppressedUnavailable,
    }));
    this.lastUnavailableLog = now;
    this.suppressedUnavailable = 0;
  }
}

/** 429 / 503 carrying a Retry-After value; ApiExceptionFilter writes the header. */
export class RateLimitError extends ApiError {
  constructor(status: HttpStatus, code: string, message: string, readonly retryAfterSeconds: number) {
    super(status, code, message);
  }
}
