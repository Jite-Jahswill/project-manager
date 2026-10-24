import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Shared Redis connection for abuse protection.
 *
 * Failure behavior is deliberately bounded (docs/security/rate-limiting-and-abuse-protection.md §2.5):
 *  - enableOfflineQueue: false  -> commands fail immediately while disconnected; no unbounded queue
 *  - maxRetriesPerRequest: 0    -> a failed command is not replayed later
 *  - commandTimeout             -> a hung server cannot hold requests open
 *  - capped reconnect back-off  -> reconnects in the background, at most every 2 s
 */
@Injectable()
export class RedisService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly client: Redis;
  private readonly logger = new Logger('Redis');
  private lastErrorLog = 0;
  private suppressedErrors = 0;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.client = new Redis(config.redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout: config.redisCommandTimeoutMs,
      connectTimeout: config.redisConnectTimeoutMs,
      retryStrategy: (times) => Math.min(times * 200, 2000),
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.client.on('error', (err: Error) => this.logError(err));
    this.client.on('ready', () => this.logger.log(JSON.stringify({ event: 'redis.ready' })));
  }

  /**
   * Startup readiness: bootstrap hooks run before the HTTP server listens, so waiting here
   * (at most the connect timeout) means a freshly started instance does not answer its first
   * requests while still connecting, which fail-closed routes would turn into 503s. It never
   * fails startup: if Redis is unreachable the instance starts degraded, exactly as during an
   * outage (rate-limited routes fail closed or open per policy).
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.ready) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.client.off('ready', done);
        resolve();
      };
      const timer = setTimeout(done, this.config.redisConnectTimeoutMs);
      this.client.once('ready', done);
    });
    if (!this.ready) this.logger.warn(JSON.stringify({ event: 'redis.not_ready_at_startup', waitedMs: this.config.redisConnectTimeoutMs }));
  }

  get ready(): boolean {
    return this.client.status === 'ready';
  }

  async ping(): Promise<boolean> {
    if (!this.ready) return false;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  /** Connection errors are logged at most every 10 s, with a count, never with the URL. */
  private logError(err: Error): void {
    const now = Date.now();
    if (now - this.lastErrorLog < 10_000) {
      this.suppressedErrors++;
      return;
    }
    this.logger.warn(JSON.stringify({ event: 'redis.error', code: (err as { code?: string }).code ?? err.name, suppressed: this.suppressedErrors }));
    this.lastErrorLog = now;
    this.suppressedErrors = 0;
  }

  async onApplicationShutdown(): Promise<void> {
    this.client.disconnect();
  }
}
