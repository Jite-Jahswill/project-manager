import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import { openWith, sealWith } from '../common/keyring';
import { AuditService } from '../audit/audit.service';
import { ActionTokenService } from '../auth/action-tokens.service';
import { PrismaService } from '../database/prisma.service';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { EmailService, outboxAad } from './email.service';
import { EmailSecretStore } from './email-secret.store';
import { adapterFor, isRealProvider } from './providers/registry';
import { EmailProviderAdapter, OutgoingEmail, ProviderError } from './providers/types';
import { renderTemplate, TEMPLATES } from './templates';

interface ClaimedJob {
  id: string;
  event_type: string;
  template_key: string;
  organization_id: string | null;
  recipient_user_id: string | null;
  recipient_email: string | null;
  payload: Record<string, string | number>;
  sensitive_ciphertext: string | null;
  attempts: number;
  expires_at: Date;
  idempotency_key: string;
  test_send: boolean;
  prev_status: string;
}

interface Resolved {
  to: string;
  vars: Record<string, string | number>;
}

class Discard extends Error {}

/**
 * Delivery worker (docs/architecture/08-email-platform.md §8.2).
 *
 * At-least-once delivery from the PostgreSQL outbox:
 *  - claim: one UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED) with a lease; any number of
 *    workers, no job processed twice concurrently; leases of crashed workers are reclaimed
 *    and that attempt is recorded as AMBIGUOUS;
 *  - configuration, provider and secret are read fresh every batch (no restart needed);
 *  - bounded exponential back-off with jitter; retryable/permanent/ambiguous classification;
 *    dead-letter = FAILED; expiry; content wiped at terminal states.
 * Never depends on Redis.
 */
@Injectable()
export class EmailWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('EmailWorker');
  readonly workerId = `w-${randomUUID().slice(0, 8)}`;
  private running = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
    private readonly secrets: EmailSecretStore,
    private readonly tokens: ActionTokenService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.emailWorkerMode === 'inline') this.start();
  }

  /**
   * First shutdown phase: stop claiming and finish the job in flight while database
   * connections are still open (they close in onApplicationShutdown).
   */
  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        let processed = 0;
        try {
          processed = await this.runOnce();
        } catch (e) {
          this.logger.warn(JSON.stringify({ event: 'email.worker_error', error: (e as Error).name }));
        }
        if (!this.running) break;
        if (processed === 0) await new Promise<void>((r) => { this.wake = r; setTimeout(r, this.config.emailWorkerPollMs); });
      }
    })();
  }

  /** Graceful: finishes the job in flight, claims nothing new. */
  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    this.loop = null;
  }

  /** One batch. Returns the number of jobs processed. Exposed for tests and the CLI. */
  async runOnce(batch = this.config.emailWorkerBatch): Promise<number> {
    const ctx = await this.loadContext();
    await this.sweep();
    const jobs = await this.claim(batch, ctx.canSend);
    let n = 0;
    for (const job of jobs) {
      if (!this.running && this.config.emailWorkerMode === 'inline' && this.loop) {
        await this.release(job, 0); // shutting down: hand back untouched
        continue;
      }
      await this.process(job, ctx);
      n++;
    }
    return n;
  }

  private async loadContext() {
    return this.db.asEmailWorker(async (tx) => {
      const settings = await tx.emailSettings.findUnique({ where: { id: 1 }, include: { activeProvider: true, defaultSender: true } });
      const provider = settings?.activeProvider ?? null;
      const production = this.config.nodeEnv === 'production';
      const usable = !!provider && !!settings?.defaultSender && (!production || isRealProvider(provider.kind));
      return {
        settings,
        provider,
        sender: settings?.defaultSender ?? null,
        // Real delivery needs the switch; test sends need only a usable provider.
        canSend: { normal: usable && !!settings?.sendingEnabled, test: usable },
      };
    });
  }

  /** Expires stale pending jobs and wipes content of dead jobs past their expiry. */
  private async sweep(): Promise<void> {
    await this.db.asEmailWorker(async (tx) => {
      await tx.$executeRaw`
        UPDATE email_outbox SET status = 'EXPIRED', payload = '{}'::jsonb, sensitive_ciphertext = NULL, content_wiped_at = now(), updated_at = now(), locked_until = NULL, locked_by = NULL
        WHERE status = 'PENDING' AND expires_at <= now()`;
      await tx.$executeRaw`
        UPDATE email_outbox SET payload = '{}'::jsonb, sensitive_ciphertext = NULL, content_wiped_at = now(), updated_at = now()
        WHERE status = 'FAILED' AND expires_at <= now() AND content_wiped_at IS NULL`;
    });
  }

  private async claim(batch: number, canSend: { normal: boolean; test: boolean }): Promise<ClaimedJob[]> {
    if (!canSend.test) return [];
    const lease = this.config.emailWorkerLeaseMs;
    return this.db.asEmailWorker((tx) => tx.$queryRaw<ClaimedJob[]>`
      WITH picked AS (
        SELECT id, status AS prev_status FROM email_outbox
        WHERE ((status = 'PENDING' AND next_attempt_at <= now()) OR (status = 'PROCESSING' AND locked_until < now()))
          AND expires_at > now()
          AND (test_send OR ${canSend.normal})
        ORDER BY next_attempt_at
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE email_outbox o
      SET status = 'PROCESSING', attempts = o.attempts + 1, locked_by = ${this.workerId},
          locked_until = now() + make_interval(secs => ${lease / 1000}), updated_at = now()
      FROM picked WHERE o.id = picked.id
      RETURNING o.id, o.event_type, o.template_key, o.organization_id, o.recipient_user_id, o.recipient_email, o.payload,
                o.sensitive_ciphertext, o.attempts, o.expires_at, o.idempotency_key, o.test_send, picked.prev_status`);
  }

  private async process(job: ClaimedJob, ctx: Awaited<ReturnType<EmailWorker['loadContext']>>): Promise<void> {
    const started = new Date();
    const providerName = ctx.provider!.kind.toLowerCase();
    if (job.prev_status === 'PROCESSING') {
      // A previous worker held this job and vanished mid-send: the outcome is unknown.
      await this.recordAttempt(job, providerName, started, 'AMBIGUOUS', 'worker_lost', 'A previous attempt was interrupted; resending with the same idempotency key', null);
    }
    try {
      if (await this.capReached(ctx.settings!.maxSendsPerMinute)) {
        await this.release(job, 5_000);
        return;
      }
      const resolved = await this.resolve(job);
      if (await this.isSuppressed(resolved.to)) throw new Discard('suppressed');
      const message = await this.render(job, resolved, ctx);
      const adapter = adapterFor(ctx.provider!.kind);
      const secret = adapter.requiresSecret || ctx.provider!.secretConfigured ? await this.secrets.get(ctx.provider!.id) : null;
      const settings = adapter.validateSettings(ctx.provider!.settings, this.config.nodeEnv === 'production');
      const { messageId } = await (adapter as EmailProviderAdapter).send(message, { settings, secret, production: this.config.nodeEnv === 'production' });
      await this.recordAttempt(job, providerName, started, 'SENT', null, null, messageId);
      await this.finish(job, 'SENT', { provider: providerName, providerMessageId: messageId });
    } catch (e) {
      if (e instanceof Discard) {
        await this.finish(job, 'DISCARDED', { lastErrorCode: e.message, provider: providerName });
        return;
      }
      const err = e instanceof ProviderError ? e : new ProviderError('permanent', 'processing_error', (e as Error).message?.slice(0, 200) ?? 'error');
      const outcome = err.kind === 'permanent' ? 'PERMANENT' : err.kind === 'ambiguous' ? 'AMBIGUOUS' : 'RETRYABLE';
      await this.recordAttempt(job, providerName, started, outcome, err.code, err.summary, null);
      const maxAttempts = ctx.settings!.retryMaxAttempts;
      if (err.kind === 'permanent' || job.attempts >= maxAttempts) {
        await this.finish(job, 'FAILED', { lastErrorCode: err.code, lastError: err.summary, provider: providerName });
        this.logger.warn(JSON.stringify({ event: 'email.failed', job: job.id, code: err.code, attempts: job.attempts }));
      } else {
        await this.release(job, backoffMs(job.attempts, ctx.settings!.retryBaseDelaySeconds, ctx.settings!.retryMaxDelaySeconds), err);
      }
    }
  }

  /** Turns the job into a recipient + template variables, asking the auth subsystem for tokens. */
  private async resolve(job: ClaimedJob): Promise<Resolved> {
    const sensitive = job.sensitive_ciphertext
      ? (JSON.parse(openWith(this.config.emailKeyRing, outboxAad(job.id), job.sensitive_ciphertext, 'outbox')) as Record<string, string>)
      : {};
    switch (job.event_type) {
      case 'auth.verify_email':
      case 'auth.verify_email_resend': {
        const user = job.recipient_user_id
          ? await this.prisma.user.findUnique({ where: { id: job.recipient_user_id } })
          : await this.prisma.user.findUnique({ where: { email: job.recipient_email! } });
        if (!user || user.emailVerifiedAt || user.status !== 'ACTIVE') throw new Discard('no_eligible_recipient');
        const token = await this.tokenFor(job, user.id, 'EMAIL_VERIFICATION', sensitive.token);
        return { to: user.email, vars: { displayName: user.displayName, link: this.email.link('/verify-email', token) } };
      }
      case 'auth.password_reset': {
        const user = await this.prisma.user.findUnique({ where: { email: job.recipient_email! } });
        if (!user || user.status !== 'ACTIVE') throw new Discard('no_eligible_recipient');
        const fresh = !sensitive.token;
        const token = await this.tokenFor(job, user.id, 'PASSWORD_RESET', sensitive.token);
        if (fresh) await this.audit.record(null, { action: 'auth.password_reset.requested', resourceType: 'user', resourceId: user.id, actorType: 'SYSTEM' });
        return { to: user.email, vars: { displayName: user.displayName, link: this.email.link('/reset-password', token) } };
      }
      case 'auth.signup_attempt':
        return { to: job.recipient_email!, vars: {} };
      case 'org.invitation':
        return { to: job.recipient_email!, vars: { orgName: job.payload.orgName, inviterName: job.payload.inviterName, link: this.email.link('/accept-invitation', sensitive.invitationToken) } };
      case 'mfa.enrollment_code': {
        const user = await this.prisma.user.findUnique({ where: { id: job.recipient_user_id! }, select: { email: true } });
        if (!user) throw new Discard('no_eligible_recipient');
        return { to: user.email, vars: { code: sensitive.code } };
      }
      case 'security.notice': {
        const user = await this.prisma.user.findUnique({ where: { id: job.recipient_user_id! }, select: { email: true } });
        if (!user) throw new Discard('no_eligible_recipient');
        return { to: user.email, vars: job.payload };
      }
      case 'platform.test':
        return { to: job.recipient_email!, vars: {} };
      default:
        throw new ProviderError('permanent', 'unknown_event', `Unknown email event ${job.event_type}`);
    }
  }

  /**
   * One token per job: created on the first attempt and kept (encrypted) for retries, so an
   * ambiguous retry re-sends the same link instead of invalidating the previous one.
   */
  private async tokenFor(job: ClaimedJob, userId: string, purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET', existing: string | undefined): Promise<string> {
    if (existing && (await this.tokens.isCurrent(userId, purpose, existing))) return existing;
    const token = await this.tokens.create(userId, purpose);
    const ct = sealWith(this.config.emailKeyRing, outboxAad(job.id), JSON.stringify({ token }));
    await this.db.asEmailWorker((tx) => tx.emailOutbox.update({ where: { id: job.id }, data: { sensitiveCiphertext: ct } }));
    return token;
  }

  private async render(job: ClaimedJob, r: Resolved, ctx: Awaited<ReturnType<EmailWorker['loadContext']>>): Promise<OutgoingEmail> {
    const def = TEMPLATES.get(job.template_key);
    if (!def) throw new ProviderError('permanent', 'unknown_template', `Unknown template ${job.template_key}`);
    const tpl = await this.db.asEmailWorker((tx) => tx.emailTemplate.findFirst({ where: { key: def.key, status: 'ACTIVE' } }));
    const content = tpl ? { subject: tpl.subject, text: tpl.textBody, html: tpl.htmlBody } : def.defaults;
    const rendered = renderTemplate(def, content, r.vars);
    await this.db.asEmailWorker((tx) => tx.emailOutbox.update({ where: { id: job.id }, data: { templateVersion: tpl?.version ?? 0 } }));
    return {
      from: { email: ctx.sender!.email, name: ctx.sender!.displayName },
      replyTo: ctx.sender!.replyTo ?? undefined,
      to: r.to,
      ...rendered,
      idempotencyKey: job.idempotency_key,
    };
  }

  private async isSuppressed(to: string): Promise<boolean> {
    return this.db.asEmailWorker(async (tx) => !!(await tx.emailSuppression.findUnique({ where: { email: to.toLowerCase() }, select: { id: true } })));
  }

  private async capReached(perMinute: number): Promise<boolean> {
    const [row] = await this.db.asEmailWorker((tx) => tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM email_delivery_attempts WHERE outcome = 'SENT' AND finished_at > now() - interval '1 minute'`);
    return row.n >= perMinute;
  }

  private async recordAttempt(job: ClaimedJob, provider: string, started: Date, outcome: 'SENT' | 'RETRYABLE' | 'PERMANENT' | 'AMBIGUOUS', code: string | null, summary: string | null, messageId: string | null) {
    const finished = new Date();
    await this.db.asEmailWorker((tx) => tx.emailDeliveryAttempt.createMany({
      data: [{
        outboxId: job.id, organizationId: job.organization_id, attempt: job.attempts, provider, startedAt: started, finishedAt: finished,
        outcome, errorCode: code, errorSummary: summary, providerMessageId: messageId, durationMs: finished.getTime() - started.getTime(),
      }],
    }));
  }

  private async finish(job: ClaimedJob, status: 'SENT' | 'FAILED' | 'DISCARDED', extra: { provider?: string; providerMessageId?: string | null; lastErrorCode?: string; lastError?: string }) {
    const now = new Date();
    // Content is wiped as soon as it is no longer needed (failed jobs keep it until expiry
    // so that an administrator can retry them).
    const wipe = status !== 'FAILED';
    await this.db.asEmailWorker((tx: Tx) => tx.emailOutbox.update({
      where: { id: job.id },
      data: {
        status, lockedBy: null, lockedUntil: null, updatedAt: now, provider: extra.provider ?? null,
        providerMessageId: extra.providerMessageId ?? null, lastErrorCode: extra.lastErrorCode ?? null, lastError: extra.lastError ?? null,
        ...(status === 'SENT' ? { sentAt: now } : {}),
        ...(wipe ? { payload: {}, sensitiveCiphertext: null, contentWipedAt: now } : {}),
      },
    }));
  }

  /** Back to PENDING after `delayMs`; a capped/shutdown release does not count as an attempt. */
  private async release(job: ClaimedJob, delayMs: number, err?: ProviderError) {
    await this.db.asEmailWorker((tx) => tx.emailOutbox.update({
      where: { id: job.id },
      data: {
        status: 'PENDING', lockedBy: null, lockedUntil: null, updatedAt: new Date(), nextAttemptAt: new Date(Date.now() + delayMs),
        ...(err ? { lastErrorCode: err.code, lastError: err.summary } : { attempts: { decrement: 1 } }),
      },
    }));
  }
}

/** Exponential back-off with "equal jitter": [d/2, d], d = min(max, base·2^(attempt-1)). */
export function backoffMs(attempt: number, baseSeconds: number, maxSeconds: number, random = Math.random): number {
  const d = Math.min(maxSeconds, baseSeconds * 2 ** Math.max(0, attempt - 1)) * 1000;
  return Math.round(d / 2 + random() * (d / 2));
}
