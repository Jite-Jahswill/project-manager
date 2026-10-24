import { Inject, Injectable, Logger, MessageEvent, OnApplicationShutdown, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { RedisService } from '../abuse/redis.service';
import { findActiveSession } from '../auth/auth.guard';
import { PlatformAuthzService } from '../authz/platform-authz.service';
import { APP_CONFIG, AppConfig } from '../config/env';
import { PrismaService } from '../database/prisma.service';
import { isSupportStaff, StaffAccess, staffAccessFrom } from './support-access';

/**
 * Real-time fan-out for support (docs/architecture/09-support.md §4).
 *
 * Delivery is best effort and NOT a source of truth: every event is published only after
 * its transaction committed, history lives in PostgreSQL, and clients recover anything
 * missed (Redis down, reconnect, publish failure) with GET .../messages?afterSeq=N.
 *
 * Transport: server-sent events over the normal authenticated HTTP pipeline (AuthGuard,
 * CSRF rules, CORS, platform guard), fanned out across API instances with Redis pub/sub.
 */
export type SupportEventType =
  | 'conversation.created' | 'conversation.updated' | 'conversation.assigned'
  | 'message.created' | 'note.created' | 'read.updated';

export interface SupportEvent {
  type: SupportEventType;
  conversationId: string;
  customerUserId: string;
  /** Assignee after the change (authorizes assigned agents). */
  assigneeUserId: string | null;
  /** For assignment changes: lets the previous assignee's client drop the conversation. */
  previousAssigneeUserId?: string | null;
  /**
   * public: customer and staff (customer receives `data` only)
   * staff:  staff only (never customer streams)
   * self:   only `targetUserId`'s own streams (e.g. read position across their sessions)
   */
  audience: 'public' | 'staff' | 'self';
  /** Staff events that also need this capability (e.g. notes). */
  requires?: 'notes';
  targetUserId?: string;
  /** Customer-safe payload. */
  data: Record<string, unknown>;
  /** Extra fields for staff streams only (identities, internal metadata). */
  staff?: Record<string, unknown>;
}

export type StreamViewer =
  | { kind: 'customer'; userId: string; sessionId: string }
  | { kind: 'staff'; userId: string; sessionId: string; access: StaffAccess };

/** What a given viewer may receive for an event (null = nothing). Pure; unit-tested. */
export function deliverableTo(viewer: StreamViewer, e: SupportEvent): Record<string, unknown> | null {
  const base = { conversationId: e.conversationId };
  if (e.audience === 'self') return e.targetUserId === viewer.userId ? { ...base, ...e.data } : null;
  if (viewer.kind === 'customer') {
    return e.audience === 'public' && e.customerUserId === viewer.userId ? { ...base, ...e.data } : null;
  }
  const a = viewer.access;
  const sees = a.inbox || (a.assigned && e.assigneeUserId === viewer.userId);
  if (!sees) {
    // The previous assignee learns only that access ended (no content).
    if (e.type === 'conversation.assigned' && e.previousAssigneeUserId === viewer.userId) return { ...base, access: 'revoked' };
    return null;
  }
  if (e.requires === 'notes' && !a.notes) return null;
  return { ...base, ...e.data, ...(e.staff ?? {}) };
}

@Injectable()
export class SupportRealtimeService implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger('SupportRealtime');
  private readonly events$ = new Subject<SupportEvent>();
  private readonly shutdown$ = new Subject<void>();
  private subscriber: Redis | null = null;
  private subscribed = false;
  readonly counters = { published: 0, publishFailed: 0, received: 0, streamsOpen: 0 };

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly platformAuthz: PlatformAuthzService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    // A dedicated connection: a subscribed ioredis client cannot run other commands.
    const sub = this.redis.client.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null, lazyConnect: false });
    this.subscriber = sub;
    sub.on('error', () => undefined); // reported by RedisService for the shared connection
    sub.on('ready', () => {
      // ioredis re-subscribes on reconnect; this covers the first connection.
      sub.subscribe(this.config.supportEventsChannel).then(() => { this.subscribed = true; }, () => { this.subscribed = false; });
    });
    sub.on('end', () => { this.subscribed = false; });
    sub.on('close', () => { this.subscribed = false; });
    sub.on('message', (channel: string, raw: string) => {
      if (channel !== this.config.supportEventsChannel) return;
      try {
        this.counters.received++;
        this.events$.next(JSON.parse(raw) as SupportEvent);
      } catch {
        this.logger.warn(JSON.stringify({ event: 'support.realtime_bad_message' }));
      }
    });
  }

  /** Ends open streams before the HTTP server closes (otherwise it waits for them). */
  onModuleDestroy(): void {
    this.shutdown$.next();
  }

  async onApplicationShutdown(): Promise<void> {
    const sub = this.subscriber;
    this.subscriber = null;
    if (sub) sub.disconnect();
  }

  get realtimeAvailable(): boolean {
    return this.subscribed && this.redis.ready;
  }

  /** Never throws: the change is already committed; clients catch up through the API. */
  async publish(event: SupportEvent): Promise<void> {
    try {
      if (!this.redis.ready) throw new Error('redis not ready');
      await this.redis.client.publish(this.config.supportEventsChannel, JSON.stringify(event));
      this.counters.published++;
    } catch {
      this.counters.publishFailed++;
      this.logger.warn(JSON.stringify({ event: 'support.realtime_publish_failed', type: event.type, conversationId: event.conversationId }));
    }
  }

  async staffViewer(userId: string, sessionId: string): Promise<StreamViewer | null> {
    const access = await this.platformAuthz.load(userId);
    if (!access) return null;
    const staff = staffAccessFrom(userId, access.permissions);
    return isSupportStaff(staff) ? { kind: 'staff', userId, sessionId, access: staff } : null;
  }

  /**
   * An authorized event stream. Re-checks the session (revocation, password change,
   * suspension) and, for staff, the permissions every supportStreamRevalidateMs; the
   * stream ends when either is gone. Assignment changes are authorized per event.
   */
  stream(initial: StreamViewer): Observable<MessageEvent> {
    return new Observable<MessageEvent>((out) => {
      let viewer = initial;
      this.counters.streamsOpen++;
      const send = (type: string, data: Record<string, unknown>) => out.next({ type, data });
      const end = (reason: string) => {
        send('end', { reason });
        out.complete();
      };
      send('ready', { realtime: this.realtimeAvailable, catchUp: 'GET messages?afterSeq=<last seq seen> for each open conversation' });
      const events = this.events$.subscribe((e) => {
        const data = deliverableTo(viewer, e);
        if (data) send(e.type, data);
      });
      const heartbeat = setInterval(() => send('ping', { realtime: this.realtimeAvailable }), this.config.supportStreamHeartbeatMs);
      let checking = false;
      const revalidate = setInterval(() => {
        if (checking) return;
        checking = true;
        void (async () => {
          try {
            if (!(await findActiveSession(this.prisma, viewer.userId, viewer.sessionId))) return end('session_ended');
            if (viewer.kind === 'staff') {
              const next = await this.staffViewer(viewer.userId, viewer.sessionId);
              if (!next) return end('access_revoked');
              viewer = next;
            }
          } catch {
            // Database unreachable: keep the stream; the next check decides.
          } finally {
            checking = false;
          }
        })();
      }, this.config.supportStreamRevalidateMs);
      const shutdown = this.shutdown$.subscribe(() => end('server_shutdown'));
      return () => {
        this.counters.streamsOpen--;
        events.unsubscribe();
        shutdown.unsubscribe();
        clearInterval(heartbeat);
        clearInterval(revalidate);
      };
    });
  }
}
