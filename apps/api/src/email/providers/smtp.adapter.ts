import nodemailer from 'nodemailer';
import { CheckResult, EmailProviderAdapter, isLocalHost, OutgoingEmail, ProviderContext, ProviderError, sanitize, SettingsValidationError } from './types';

export type SmtpSecurity = 'starttls' | 'tls' | 'none';

export interface SmtpSettings {
  host: string;
  port: number;
  /** starttls: upgrade required (never silently downgraded); tls: implicit TLS; none: dev/test only. */
  security: SmtpSecurity;
  /** Certificate verification. Disabling it is refused in production. */
  verifyCertificate: boolean;
  username: string | null;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  socketTimeoutMs: number;
}

const HOST = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$|^\d{1,3}(\.\d{1,3}){3}$/;

/** Generic SMTP via nodemailer. Transport security is validated; it is never downgraded. */
export class SmtpAdapter implements EmailProviderAdapter<SmtpSettings> {
  readonly kind = 'SMTP' as const;
  readonly requiresSecret = false; // only when `username` is set

  validateSettings(raw: unknown, production: boolean): SmtpSettings {
    const r = (raw ?? {}) as Record<string, unknown>;
    const allowed = new Set(['host', 'port', 'security', 'verifyCertificate', 'username', 'connectionTimeoutMs', 'greetingTimeoutMs', 'socketTimeoutMs']);
    for (const k of Object.keys(r)) if (!allowed.has(k)) throw new SettingsValidationError(`Unknown SMTP setting "${k}"`);
    const host = String(r.host ?? '').trim().toLowerCase();
    if (!HOST.test(host) && !isLocalHost(host)) throw new SettingsValidationError('host must be a hostname or IPv4 address');
    const port = Number(r.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SettingsValidationError('port must be 1-65535');
    const security = String(r.security ?? 'starttls') as SmtpSecurity;
    if (!['starttls', 'tls', 'none'].includes(security)) throw new SettingsValidationError('security must be starttls, tls or none');
    const verifyCertificate = r.verifyCertificate === undefined ? true : r.verifyCertificate === true;
    if (r.verifyCertificate !== undefined && typeof r.verifyCertificate !== 'boolean') throw new SettingsValidationError('verifyCertificate must be a boolean');
    if (production && security === 'none') throw new SettingsValidationError('Unencrypted SMTP is refused in production; use starttls or tls');
    if (production && !verifyCertificate) throw new SettingsValidationError('Certificate verification cannot be disabled in production');
    if (security === 'none' && !isLocalHost(host)) throw new SettingsValidationError('Unencrypted SMTP is allowed only to localhost (development)');
    const username = r.username === undefined || r.username === null || r.username === '' ? null : String(r.username);
    if (username !== null && (username.length > 200 || /[\r\n]/.test(username))) throw new SettingsValidationError('username is invalid');
    const timeout = (name: string, def: number) => {
      const v = r[name] === undefined ? def : Number(r[name]);
      if (!Number.isInteger(v) || v < 1000 || v > 60_000) throw new SettingsValidationError(`${name} must be 1000-60000`);
      return v;
    };
    return {
      host, port, security, verifyCertificate, username,
      connectionTimeoutMs: timeout('connectionTimeoutMs', 10_000),
      greetingTimeoutMs: timeout('greetingTimeoutMs', 10_000),
      socketTimeoutMs: timeout('socketTimeoutMs', 20_000),
    };
  }

  validateSecret(secret: string): void {
    if (!secret || secret.length > 500 || /[\r\n]/.test(secret)) throw new SettingsValidationError('SMTP password must be 1-500 characters without line breaks');
  }

  secretHint(): string {
    return 'configured';
  }

  private transport(ctx: ProviderContext<SmtpSettings>) {
    const s = ctx.settings;
    if (s.username && !ctx.secret) throw new ProviderError('permanent', 'missing_credentials', 'The SMTP password is not configured');
    return nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.security === 'tls',
      requireTLS: s.security === 'starttls',
      ignoreTLS: s.security === 'none',
      auth: s.username ? { user: s.username, pass: ctx.secret ?? '' } : undefined,
      tls: { rejectUnauthorized: s.verifyCertificate, minVersion: 'TLSv1.2', servername: s.host },
      connectionTimeout: s.connectionTimeoutMs,
      greetingTimeout: s.greetingTimeoutMs,
      socketTimeout: s.socketTimeoutMs,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(m: OutgoingEmail, ctx: ProviderContext<SmtpSettings>): Promise<{ messageId: string | null }> {
    const t = this.transport(ctx);
    try {
      const info = await t.sendMail({
        from: { name: m.from.name, address: m.from.email },
        to: m.to,
        replyTo: m.replyTo,
        subject: m.subject,
        text: m.text,
        html: m.html,
        // SMTP has no idempotency; a stable Message-ID at least lets downstream systems de-duplicate.
        messageId: `<${m.idempotencyKey}@ventidoc.email>`,
      });
      return { messageId: info.messageId ?? null };
    } catch (e) {
      throw this.classify(e, ctx.secret);
    } finally {
      t.close();
    }
  }

  async check(ctx: ProviderContext<SmtpSettings>): Promise<CheckResult> {
    try {
      await this.transport(ctx).verify();
      return { ok: true, summary: 'Connected, negotiated the configured security and authenticated', domainVerified: null };
    } catch (e) {
      const err = e instanceof ProviderError ? e : this.classify(e, ctx.secret);
      return { ok: false, summary: err.summary, domainVerified: null };
    }
  }

  private classify(e: unknown, secret: string | null): ProviderError {
    const err = e as { code?: string; responseCode?: number; command?: string; message?: string };
    const summary = sanitize(`${err.code ?? 'error'}${err.responseCode ? ` ${err.responseCode}` : ''}: ${err.message ?? ''}`, secret);
    if (err.responseCode && err.responseCode >= 500) return new ProviderError('permanent', `smtp_${err.responseCode}`, summary);
    if (err.responseCode && err.responseCode >= 400) return new ProviderError('retryable', `smtp_${err.responseCode}`, summary);
    if (err.code === 'EAUTH' || err.code === 'EENVELOPE' || err.code === 'EMESSAGE' || err.code === 'ETLS' || /certificate|self.signed|unable to verify/i.test(err.message ?? '')) {
      return new ProviderError('permanent', (err.code ?? 'smtp_error').toLowerCase(), summary);
    }
    // A timeout once the message was being transmitted: it may have been accepted.
    if ((err.code === 'ETIMEDOUT' || err.code === 'ESOCKET') && (err.command === 'DATA' || err.command === '.' || err.command === 'MESSAGE')) {
      return new ProviderError('ambiguous', 'timeout_during_data', summary);
    }
    return new ProviderError('retryable', (err.code ?? 'smtp_error').toLowerCase(), summary);
  }
}
