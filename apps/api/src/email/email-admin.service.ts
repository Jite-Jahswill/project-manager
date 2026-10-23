import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { ApiError, Errors } from '../common/errors';
import { normalizeEmail } from '../common/crypto';
import type { RequestMeta } from '../common/request-context';
import { TenantDb, Tx } from '../database/tenant-db.service';
import { PrismaService } from '../database/prisma.service';
import { EmailService } from './email.service';
import { EmailSecretStore } from './email-secret.store';
import { adapterFor, isRealProvider } from './providers/registry';
import { SettingsValidationError } from './providers/types';
import { renderTemplate, sampleVariables, TEMPLATES, TemplateValidationError, validateTemplate } from './templates';
import type {
  CreateProviderDto, PreviewTemplateDto, SenderIdentityDto, SuppressionDto, TemplateVersionDto, UpdateEmailSettingsDto,
  UpdateProviderDto, UpdateSenderIdentityDto,
} from './dto/email-admin.dto';

const conflict = (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, code, message);
const invalid = (e: unknown) => {
  if (e instanceof SettingsValidationError || e instanceof TemplateValidationError) return Errors.badRequest('invalid_email_configuration', e.message);
  throw e;
};

const PROVIDER_VIEW = {
  id: true, kind: true, name: true, settings: true, secretConfigured: true, secretHint: true, status: true,
  lastCheckedAt: true, lastCheckSummary: true, createdAt: true, updatedAt: true,
} as const;

/** Masks a recipient for operational views: "j***@example.com". */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain ?? ''}`;
}

/**
 * Platform-admin email configuration (docs/security/email.md §3). Every method runs in
 * platform scope behind PlatformAccessGuard (permission, administrator MFA, step-up for
 * privileged permissions). Secrets are write-only.
 */
@Injectable()
export class EmailAdminService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
    private readonly secrets: EmailSecretStore,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  private get production() {
    return this.config.nodeEnv === 'production';
  }

  getConfiguration(adminId: string) {
    return this.db.asPlatform(adminId, async (tx) => ({
      settings: await tx.emailSettings.findUnique({ where: { id: 1 } }),
      providers: await tx.emailProvider.findMany({ select: PROVIDER_VIEW, orderBy: { createdAt: 'asc' } }),
      senderIdentities: await tx.emailSenderIdentity.findMany({ orderBy: { createdAt: 'asc' } }),
      supportedProviders: this.production ? ['RESEND', 'SMTP'] : ['RESEND', 'SMTP', 'LOG', 'CAPTURE'],
    }));
  }

  updateSettings(adminId: string, dto: UpdateEmailSettingsDto, meta: RequestMeta) {
    return this.db.asPlatform(adminId, async (tx) => {
      const before = await tx.emailSettings.findUniqueOrThrow({ where: { id: 1 } });
      const base = dto.retryBaseDelaySeconds ?? before.retryBaseDelaySeconds;
      const max = dto.retryMaxDelaySeconds ?? before.retryMaxDelaySeconds;
      if (max < base) throw Errors.badRequest('invalid_email_configuration', 'retryMaxDelaySeconds must be >= retryBaseDelaySeconds');
      let disableSending = false;
      if (dto.defaultSenderId && dto.defaultSenderId !== before.defaultSenderId) {
        const sender = await tx.emailSenderIdentity.findUnique({ where: { id: dto.defaultSenderId } });
        if (!sender) throw Errors.notFound('Sender identity');
        disableSending = before.sendingEnabled && !sender.verifiedAt;
      }
      const after = await tx.emailSettings.update({
        where: { id: 1 },
        data: {
          ...dto,
          testRecipients: dto.testRecipients?.map(normalizeEmail),
          ...(disableSending ? { sendingEnabled: false } : {}),
          updatedAt: new Date(), updatedBy: adminId,
        },
      });
      await this.record(tx, adminId, 'platform.email.settings_updated', 'email_settings', '1', meta, { before, after, sendingDisabled: disableSending });
      return after;
    });
  }

  /** Activation of a provider; switching away from the verified one turns real sending off until re-verified. */
  activateProvider(adminId: string, providerId: string, meta: RequestMeta) {
    return this.db.asPlatform(adminId, async (tx) => {
      const p = await tx.emailProvider.findUnique({ where: { id: providerId } });
      if (!p) throw Errors.notFound('Email provider');
      if (this.production && !isRealProvider(p.kind)) throw Errors.badRequest('invalid_email_configuration', `${p.kind} is not allowed in production`);
      const before = await tx.emailSettings.findUniqueOrThrow({ where: { id: 1 } });
      const keepSending = before.sendingEnabled && (p.status === 'VERIFIED' || !isRealProvider(p.kind));
      const after = await tx.emailSettings.update({
        where: { id: 1 }, data: { activeProviderId: p.id, sendingEnabled: keepSending, updatedAt: new Date(), updatedBy: adminId },
      });
      await this.record(tx, adminId, 'platform.email.provider_activated', 'email_provider', p.id, meta, { kind: p.kind, sendingEnabled: after.sendingEnabled });
      return after;
    });
  }

  /**
   * Turns real delivery on or off. On requires: an active provider that passed its check,
   * its credential configured, and a verified default sender domain. Off is always allowed.
   */
  setSending(adminId: string, enabled: boolean, meta: RequestMeta) {
    return this.db.asPlatform(adminId, async (tx) => {
      const s = await tx.emailSettings.findUniqueOrThrow({ where: { id: 1 }, include: { activeProvider: true, defaultSender: true } });
      if (enabled) {
        const p = s.activeProvider;
        if (!p) throw conflict('email_not_ready', 'No active email provider');
        if (!s.defaultSender) throw conflict('email_not_ready', 'No default sender identity');
        if (isRealProvider(p.kind)) {
          if (p.status !== 'VERIFIED') throw conflict('email_not_ready', 'The active provider has not passed a configuration check');
          if (adapterFor(p.kind).requiresSecret && !p.secretConfigured) throw conflict('email_not_ready', 'The provider credential is not configured');
          if (!s.defaultSender.verifiedAt) throw conflict('email_not_ready', `The sender domain ${s.defaultSender.domain} is not verified`);
        } else if (this.production) {
          throw conflict('email_not_ready', `${p.kind} is not allowed in production`);
        }
      }
      const after = await tx.emailSettings.update({ where: { id: 1 }, data: { sendingEnabled: enabled, updatedAt: new Date(), updatedBy: adminId } });
      await this.record(tx, adminId, enabled ? 'platform.email.sending_enabled' : 'platform.email.sending_disabled', 'email_settings', '1', meta, {});
      return after;
    });
  }

  createProvider(adminId: string, dto: CreateProviderDto, meta: RequestMeta) {
    let settings: unknown;
    try {
      if (this.production && !isRealProvider(dto.kind)) throw new SettingsValidationError(`${dto.kind} is not allowed in production`);
      settings = adapterFor(dto.kind).validateSettings(dto.settings ?? {}, this.production);
    } catch (e) {
      throw invalid(e);
    }
    return this.db.asPlatform(adminId, async (tx) => {
      if (await tx.emailProvider.findUnique({ where: { name: dto.name } })) throw conflict('provider_name_taken', 'A provider with this name exists');
      const p = await tx.emailProvider.create({
        data: { kind: dto.kind, name: dto.name, settings: settings as object, createdBy: adminId, updatedBy: adminId },
        select: PROVIDER_VIEW,
      });
      await this.record(tx, adminId, 'platform.email.provider_created', 'email_provider', p.id, meta, { kind: p.kind, name: p.name, settings: p.settings });
      return p;
    });
  }

  updateProvider(adminId: string, providerId: string, dto: UpdateProviderDto, meta: RequestMeta) {
    return this.db.asPlatform(adminId, async (tx) => {
      const p = await tx.emailProvider.findUnique({ where: { id: providerId } });
      if (!p) throw Errors.notFound('Email provider');
      let settings = p.settings;
      if (dto.settings) {
        try {
          settings = adapterFor(p.kind).validateSettings(dto.settings, this.production) as object;
        } catch (e) {
          throw invalid(e);
        }
      }
      const updated = await tx.emailProvider.update({
        where: { id: providerId },
        // Any settings change requires a new check before real sending.
        data: { ...(dto.name ? { name: dto.name } : {}), settings: settings as object, ...(dto.settings ? { status: 'UNVERIFIED' } : {}), updatedAt: new Date(), updatedBy: adminId },
        select: PROVIDER_VIEW,
      });
      const disabled = dto.settings ? await this.disableIfActive(tx, providerId) : false;
      await this.record(tx, adminId, 'platform.email.provider_updated', 'email_provider', providerId, meta, { before: p.settings, after: updated.settings, sendingDisabled: disabled });
      return updated;
    });
  }

  /** Write-only. Stored encrypted under EMAIL_SECRET_KEYS through the ventidoc_auth role. */
  async setSecret(adminId: string, providerId: string, secret: string, meta: RequestMeta) {
    const p = await this.db.asPlatform(adminId, (tx) => tx.emailProvider.findUnique({ where: { id: providerId } }));
    if (!p) throw Errors.notFound('Email provider');
    const adapter = adapterFor(p.kind);
    try {
      adapter.validateSecret(secret);
    } catch (e) {
      throw invalid(e);
    }
    await this.secrets.put(providerId, secret);
    return this.db.asPlatform(adminId, async (tx) => {
      const updated = await tx.emailProvider.update({
        where: { id: providerId },
        data: { secretConfigured: true, secretHint: adapter.secretHint(secret), status: 'UNVERIFIED', updatedAt: new Date(), updatedBy: adminId },
        select: PROVIDER_VIEW,
      });
      const disabled = await this.disableIfActive(tx, providerId);
      await this.record(tx, adminId, 'platform.email.secret_set', 'email_provider', providerId, meta, { hint: updated.secretHint, sendingDisabled: disabled });
      return updated;
    });
  }

  async clearSecret(adminId: string, providerId: string, meta: RequestMeta) {
    await this.secrets.remove(providerId);
    return this.db.asPlatform(adminId, async (tx) => {
      const updated = await tx.emailProvider.update({
        where: { id: providerId }, data: { secretConfigured: false, secretHint: null, status: 'UNVERIFIED', updatedAt: new Date(), updatedBy: adminId }, select: PROVIDER_VIEW,
      });
      const disabled = await this.disableIfActive(tx, providerId);
      await this.record(tx, adminId, 'platform.email.secret_cleared', 'email_provider', providerId, meta, { sendingDisabled: disabled });
      return updated;
    });
  }

  /**
   * Connection/configuration check. For Resend, a verified sender domain marks the
   * default sender identity verified. Results are sanitized before storage.
   */
  async checkProvider(adminId: string, providerId: string, meta: RequestMeta) {
    const { p, sender } = await this.db.asPlatform(adminId, async (tx) => ({
      p: await tx.emailProvider.findUnique({ where: { id: providerId } }),
      sender: (await tx.emailSettings.findUnique({ where: { id: 1 }, include: { defaultSender: true } }))?.defaultSender ?? null,
    }));
    if (!p) throw Errors.notFound('Email provider');
    const adapter = adapterFor(p.kind);
    const secret = p.secretConfigured ? await this.secrets.get(p.id) : null;
    const settings = adapter.validateSettings(p.settings, this.production);
    const result = await adapter.check({ settings, secret, production: this.production }, sender?.domain ?? null);
    return this.db.asPlatform(adminId, async (tx) => {
      const updated = await tx.emailProvider.update({
        where: { id: providerId },
        data: { status: result.ok ? 'VERIFIED' : 'FAILED', lastCheckedAt: new Date(), lastCheckSummary: result.summary },
        select: PROVIDER_VIEW,
      });
      if (sender && result.domainVerified !== null) {
        await tx.emailSenderIdentity.update({
          where: { id: sender.id },
          data: result.domainVerified ? { verifiedAt: new Date(), verificationSource: `${p.kind.toLowerCase()}_domain_check` } : { verifiedAt: null, verificationSource: null },
        });
        if (!result.domainVerified) await tx.emailSettings.update({ where: { id: 1 }, data: { sendingEnabled: false } });
      }
      if (!result.ok) await this.disableIfActive(tx, providerId);
      await this.record(tx, adminId, 'platform.email.provider_checked', 'email_provider', providerId, meta, { ok: result.ok, summary: result.summary, domainVerified: result.domainVerified });
      return { provider: updated, check: result };
    });
  }

  createSenderIdentity(adminId: string, dto: SenderIdentityDto, meta: RequestMeta) {
    const email = normalizeEmail(dto.email);
    return this.db.asPlatform(adminId, async (tx) => {
      if (await tx.emailSenderIdentity.findUnique({ where: { email } })) throw conflict('sender_exists', 'This sender identity exists');
      const s = await tx.emailSenderIdentity.create({
        data: { email, displayName: dto.displayName.trim(), replyTo: dto.replyTo ? normalizeEmail(dto.replyTo) : null, domain: email.split('@')[1], createdBy: adminId },
      });
      await this.record(tx, adminId, 'platform.email.sender_created', 'email_sender_identity', s.id, meta, { email: s.email });
      return s;
    });
  }

  updateSenderIdentity(adminId: string, id: string, dto: UpdateSenderIdentityDto, meta: RequestMeta) {
    return this.db.asPlatform(adminId, async (tx) => {
      const before = await tx.emailSenderIdentity.findUnique({ where: { id } });
      if (!before) throw Errors.notFound('Sender identity');
      const s = await tx.emailSenderIdentity.update({
        where: { id },
        data: { ...(dto.displayName ? { displayName: dto.displayName.trim() } : {}), ...(dto.replyTo !== undefined ? { replyTo: dto.replyTo ? normalizeEmail(dto.replyTo) : null } : {}) },
      });
      await this.record(tx, adminId, 'platform.email.sender_updated', 'email_sender_identity', id, meta, { before, after: s });
      return s;
    });
  }

  /** SMTP cannot verify DNS: an administrator attests SPF/DKIM/DMARC verification (audited). */
  attestDomain(adminId: string, id: string, statement: string, meta: RequestMeta) {
    return this.db.asPlatform(adminId, async (tx) => {
      const settings = await tx.emailSettings.findUniqueOrThrow({ where: { id: 1 }, include: { activeProvider: true } });
      if (settings.activeProvider?.kind !== 'SMTP') throw conflict('attestation_not_applicable', 'Domain attestation applies to SMTP only; Resend verifies domains via its API check');
      const s = await tx.emailSenderIdentity.update({ where: { id }, data: { verifiedAt: new Date(), verificationSource: 'admin_attestation' } }).catch(() => {
        throw Errors.notFound('Sender identity');
      });
      await this.record(tx, adminId, 'platform.email.sender_domain_attested', 'email_sender_identity', id, meta, { domain: s.domain, statement });
      return s;
    });
  }

  listTemplates(adminId: string) {
    return this.db.asPlatform(adminId, async (tx) => {
      const rows = await tx.emailTemplate.findMany({
        select: { key: true, version: true, status: true, subject: true, createdAt: true, activatedAt: true },
        orderBy: [{ key: 'asc' }, { version: 'desc' }],
      });
      return [...TEMPLATES.values()].map((d) => ({
        key: d.key, description: d.description, variables: d.variables, required: d.required, lockedFooter: d.lockedFooter,
        versions: rows.filter((r) => r.key === d.key),
      }));
    });
  }

  getTemplateVersion(adminId: string, key: string, version: number) {
    return this.db.asPlatform(adminId, async (tx) => {
      const t = await tx.emailTemplate.findUnique({ where: { key_version: { key, version } } });
      if (!t) throw Errors.notFound('Template version');
      return t;
    });
  }

  createTemplateVersion(adminId: string, key: string, dto: TemplateVersionDto, meta: RequestMeta) {
    const def = TEMPLATES.get(key);
    if (!def) throw Errors.notFound('Template');
    try {
      validateTemplate(def, dto);
    } catch (e) {
      throw invalid(e);
    }
    return this.db.asPlatform(adminId, async (tx) => {
      const last = await tx.emailTemplate.findFirst({ where: { key }, orderBy: { version: 'desc' }, select: { version: true } });
      const t = await tx.emailTemplate.create({
        data: { key, version: (last?.version ?? 0) + 1, subject: dto.subject, textBody: dto.text, htmlBody: dto.html, createdBy: adminId },
      });
      await this.record(tx, adminId, 'platform.email.template_version_created', 'email_template', `${key}@${t.version}`, meta, { key, version: t.version });
      return t;
    });
  }

  activateTemplateVersion(adminId: string, key: string, version: number, meta: RequestMeta) {
    return this.db.asPlatform(adminId, async (tx) => {
      const t = await tx.emailTemplate.findUnique({ where: { key_version: { key, version } } });
      if (!t) throw Errors.notFound('Template version');
      const def = TEMPLATES.get(key)!;
      try {
        validateTemplate(def, { subject: t.subject, text: t.textBody, html: t.htmlBody });
      } catch (e) {
        throw invalid(e);
      }
      await tx.emailTemplate.updateMany({ where: { key, status: 'ACTIVE' }, data: { status: 'RETIRED' } });
      const active = await tx.emailTemplate.update({ where: { id: t.id }, data: { status: 'ACTIVE', activatedAt: new Date(), activatedBy: adminId } });
      await this.record(tx, adminId, 'platform.email.template_version_activated', 'email_template', `${key}@${version}`, meta, { key, version });
      return active;
    });
  }

  /** Renders with sample values only (never real recipients or tokens). */
  async previewTemplate(adminId: string, key: string, dto: PreviewTemplateDto) {
    const def = TEMPLATES.get(key);
    if (!def) throw Errors.notFound('Template');
    let content = def.defaults;
    if (dto.version) {
      const t = await this.getTemplateVersion(adminId, key, dto.version);
      content = { subject: t.subject, text: t.textBody, html: t.htmlBody };
    } else if (dto.subject || dto.text || dto.html) {
      content = { subject: dto.subject ?? def.defaults.subject, text: dto.text ?? def.defaults.text, html: dto.html ?? def.defaults.html };
    } else {
      const active = await this.db.asPlatform(adminId, (tx) => tx.emailTemplate.findFirst({ where: { key, status: 'ACTIVE' } }));
      if (active) content = { subject: active.subject, text: active.textBody, html: active.htmlBody };
    }
    try {
      validateTemplate(def, content);
      return renderTemplate(def, content, sampleVariables(def));
    } catch (e) {
      throw invalid(e);
    }
  }

  /** Test email to the requesting admin's own address or an allow-listed test recipient. */
  async testSend(adminId: string, to: string, meta: RequestMeta) {
    const recipient = normalizeEmail(to);
    const admin = await this.prisma.user.findUniqueOrThrow({ where: { id: adminId }, select: { email: true } });
    const settings = await this.db.asPlatform(adminId, (tx) => tx.emailSettings.findUniqueOrThrow({ where: { id: 1 } }));
    if (recipient !== admin.email && !settings.testRecipients.includes(recipient)) {
      throw Errors.forbidden('Test emails may only go to your own address or an allow-listed test recipient');
    }
    if (!settings.activeProviderId) throw conflict('email_not_ready', 'No active email provider');
    const id = await this.db.asPlatform(adminId, async (tx) => {
      const jobId = await this.email.enqueue({ type: 'platform.test', to: recipient, requestedBy: adminId }, tx, { testSend: true });
      await this.record(tx, adminId, 'platform.email.test_requested', 'email_outbox', jobId, meta, { to: maskEmail(recipient) });
      return jobId;
    });
    return { jobId: id };
  }

  listDeliveries(adminId: string, status?: string, limit = 50) {
    return this.db.asPlatform(adminId, async (tx) => {
      const rows = await tx.emailOutbox.findMany({
        where: status ? { status: status as never } : {},
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: DELIVERY_VIEW,
      });
      return rows.map(deliveryView);
    });
  }

  getDelivery(adminId: string, id: string) {
    return this.db.asPlatform(adminId, async (tx) => {
      const row = await tx.emailOutbox.findUnique({ where: { id }, select: { ...DELIVERY_VIEW, attemptLog: { orderBy: { startedAt: 'asc' } } } });
      if (!row) throw Errors.notFound('Delivery');
      return { ...deliveryView(row), attempts: row.attemptLog.map((a) => ({ ...a, outboxId: undefined, organizationId: undefined })) };
    });
  }

  /** Controlled retry of a dead (FAILED) job whose content is still present and not expired. */
  retryDelivery(adminId: string, id: string, meta: RequestMeta) {
    return this.db.asPlatform(adminId, async (tx) => {
      const n = await tx.emailOutbox.updateMany({
        where: { id, status: 'FAILED', contentWipedAt: null, expiresAt: { gt: new Date() } },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), updatedAt: new Date() },
      });
      if (n.count !== 1) throw conflict('delivery_not_retryable', 'Only failed, unexpired deliveries with content can be retried');
      await this.record(tx, adminId, 'platform.email.delivery_retried', 'email_outbox', id, meta, {});
      return { id, status: 'PENDING' };
    });
  }

  cancelDelivery(adminId: string, id: string, meta: RequestMeta) {
    return this.db.asPlatform(adminId, async (tx) => {
      const n = await tx.emailOutbox.updateMany({
        where: { id, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'CANCELLED', payload: {}, sensitiveCiphertext: null, contentWipedAt: new Date(), updatedAt: new Date() },
      });
      if (n.count !== 1) throw conflict('delivery_not_cancellable', 'Only pending or failed deliveries can be cancelled');
      await this.record(tx, adminId, 'platform.email.delivery_cancelled', 'email_outbox', id, meta, {});
    });
  }

  metrics(adminId: string) {
    return this.db.asPlatform(adminId, async (tx) => {
      const byStatus = await tx.$queryRaw<{ status: string; n: number }[]>`SELECT status::text, count(*)::int AS n FROM email_outbox GROUP BY status`;
      const [age] = await tx.$queryRaw<{ seconds: number | null }[]>`
        SELECT EXTRACT(EPOCH FROM (now() - min(created_at)))::int AS seconds FROM email_outbox WHERE status IN ('PENDING', 'PROCESSING')`;
      const outcomes = await tx.$queryRaw<{ outcome: string; n: number }[]>`
        SELECT outcome::text, count(*)::int AS n FROM email_delivery_attempts WHERE finished_at > now() - interval '1 hour' GROUP BY outcome`;
      const [latency] = await tx.$queryRaw<{ p50: number | null; p95: number | null }[]>`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (sent_at - created_at)))::float AS p50,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (sent_at - created_at)))::float AS p95
        FROM email_outbox WHERE status = 'SENT' AND sent_at > now() - interval '1 hour'`;
      return {
        queue: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
        oldestPendingSeconds: age?.seconds ?? 0,
        lastHourAttempts: Object.fromEntries(outcomes.map((r) => [r.outcome, r.n])),
        lastHourLatencySeconds: { p50: latency?.p50 ?? null, p95: latency?.p95 ?? null },
      };
    });
  }

  listSuppressions(adminId: string) {
    return this.db.asPlatform(adminId, (tx) => tx.emailSuppression.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }));
  }

  addSuppression(adminId: string, dto: SuppressionDto, meta: RequestMeta) {
    const email = normalizeEmail(dto.email);
    return this.db.asPlatform(adminId, async (tx) => {
      const s = await tx.emailSuppression.upsert({
        where: { email }, create: { email, reason: dto.reason, note: dto.note ?? null, createdBy: adminId }, update: { reason: dto.reason, note: dto.note ?? null },
      });
      await this.record(tx, adminId, 'platform.email.suppression_added', 'email_suppression', s.id, meta, { email: maskEmail(email), reason: dto.reason });
      return s;
    });
  }

  removeSuppression(adminId: string, id: string, meta: RequestMeta) {
    return this.db.asPlatform(adminId, async (tx) => {
      const n = await tx.emailSuppression.deleteMany({ where: { id } });
      if (n.count !== 1) throw Errors.notFound('Suppression');
      await this.record(tx, adminId, 'platform.email.suppression_removed', 'email_suppression', id, meta, {});
    });
  }

  auditHistory(adminId: string, limit = 100) {
    return this.db.asPlatform(adminId, (tx) =>
      tx.auditEvent.findMany({ where: { action: { startsWith: 'platform.email.' } }, orderBy: { occurredAt: 'desc' }, take: Math.min(limit, 200) }));
  }

  private async disableIfActive(tx: Tx, providerId: string): Promise<boolean> {
    const n = await tx.emailSettings.updateMany({ where: { id: 1, activeProviderId: providerId, sendingEnabled: true }, data: { sendingEnabled: false } });
    return n.count === 1;
  }

  private record(tx: Tx, adminId: string, action: string, resourceType: string, resourceId: string, meta: RequestMeta, metadata: Record<string, unknown>) {
    return this.audit.record(tx, { action, resourceType, resourceId, actorType: 'PLATFORM_ADMIN', actorUserId: adminId, metadata }, meta);
  }
}

const DELIVERY_VIEW = {
  id: true, eventType: true, templateKey: true, templateVersion: true, organizationId: true, recipientEmail: true, status: true,
  attempts: true, nextAttemptAt: true, expiresAt: true, testSend: true, provider: true, providerMessageId: true, lastErrorCode: true,
  lastError: true, contentWipedAt: true, createdAt: true, updatedAt: true, sentAt: true,
} as const;

/** Operational metadata only: no payload, no sensitive data, recipient masked. */
function deliveryView<T extends { recipientEmail: string | null }>(row: T) {
  return { ...row, recipientEmail: maskEmail(row.recipientEmail) };
}
