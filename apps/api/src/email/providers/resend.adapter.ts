import { CheckResult, EmailProviderAdapter, isLocalHost, OutgoingEmail, ProviderContext, ProviderError, sanitize, SettingsValidationError } from './types';

export interface ResendSettings {
  apiBaseUrl: string;
  timeoutMs: number;
}

/**
 * Resend HTTP API (POST /emails, GET /domains). Implemented directly on fetch so the
 * request format is explicit and testable without production credentials.
 * Idempotency-Key = the outbox job's key: a retry after an ambiguous timeout is
 * de-duplicated by Resend within its idempotency window.
 */
export class ResendAdapter implements EmailProviderAdapter<ResendSettings> {
  readonly kind = 'RESEND' as const;
  readonly requiresSecret = true;

  validateSettings(raw: unknown, production: boolean): ResendSettings {
    const r = (raw ?? {}) as Record<string, unknown>;
    const allowed = new Set(['apiBaseUrl', 'timeoutMs']);
    for (const k of Object.keys(r)) if (!allowed.has(k)) throw new SettingsValidationError(`Unknown Resend setting "${k}"`);
    const apiBaseUrl = String(r.apiBaseUrl ?? 'https://api.resend.com').replace(/\/+$/, '');
    let url: URL;
    try {
      url = new URL(apiBaseUrl);
    } catch {
      throw new SettingsValidationError('apiBaseUrl must be a URL');
    }
    const local = isLocalHost(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && !production)) {
      throw new SettingsValidationError('apiBaseUrl must use https (plain http is allowed only for localhost outside production)');
    }
    if (production && local) throw new SettingsValidationError('apiBaseUrl cannot be localhost in production');
    const timeoutMs = r.timeoutMs === undefined ? 10_000 : Number(r.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000) throw new SettingsValidationError('timeoutMs must be 1000-30000');
    return { apiBaseUrl, timeoutMs };
  }

  validateSecret(secret: string): void {
    if (!/^re_[A-Za-z0-9_]{8,200}$/.test(secret)) throw new SettingsValidationError('A Resend API key looks like re_… (letters, digits, underscores)');
  }

  secretHint(secret: string): string {
    return `re_…${secret.slice(-4)}`;
  }

  async send(m: OutgoingEmail, ctx: ProviderContext<ResendSettings>): Promise<{ messageId: string | null }> {
    if (!ctx.secret) throw new ProviderError('permanent', 'missing_credentials', 'The Resend API key is not configured');
    const body = {
      from: `${m.from.name.replace(/[<>"\r\n]/g, '')} <${m.from.email}>`,
      to: [m.to],
      subject: m.subject,
      text: m.text,
      html: m.html,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    };
    const res = await this.request(ctx, '/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
      body: JSON.stringify(body),
    }, true);
    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as { id?: unknown };
      return { messageId: typeof json.id === 'string' ? json.id : null };
    }
    throw await this.classify(res, ctx.secret);
  }

  async check(ctx: ProviderContext<ResendSettings>, senderDomain: string | null): Promise<CheckResult> {
    if (!ctx.secret) return { ok: false, summary: 'API key not configured', domainVerified: null };
    let res: Response;
    try {
      res = await this.request(ctx, '/domains', { method: 'GET' }, false);
    } catch (e) {
      return { ok: false, summary: sanitize(e instanceof ProviderError ? e.summary : 'request failed', ctx.secret), domainVerified: null };
    }
    const json = (await res.json().catch(() => ({}))) as { data?: { name?: string; status?: string }[]; name?: string; message?: string };
    if (res.status === 401 && /restricted/i.test(`${json.name ?? ''} ${json.message ?? ''}`)) {
      return { ok: true, summary: 'API key accepted but restricted to sending; domain status cannot be read with this key', domainVerified: null };
    }
    if (!res.ok) return { ok: false, summary: sanitize(`Resend rejected the check: HTTP ${res.status} ${json.name ?? ''} ${json.message ?? ''}`, ctx.secret), domainVerified: null };
    const domain = senderDomain ? (json.data ?? []).find((d) => d.name?.toLowerCase() === senderDomain.toLowerCase()) : undefined;
    if (!senderDomain) return { ok: true, summary: 'API key valid; no sender domain to check', domainVerified: null };
    if (!domain) return { ok: true, summary: `API key valid; domain ${senderDomain} is not added in Resend`, domainVerified: false };
    const verified = domain.status === 'verified';
    return { ok: true, summary: `API key valid; domain ${senderDomain} status: ${sanitize(String(domain.status))}`, domainVerified: verified };
  }

  private async request(ctx: ProviderContext<ResendSettings>, path: string, init: RequestInit, sending: boolean): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.settings.timeoutMs);
    try {
      return await fetch(`${ctx.settings.apiBaseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${ctx.secret}`, 'User-Agent': 'ventidoc-email/1' },
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (e) {
      const err = e as { name?: string; cause?: { code?: string; message?: string; errors?: { code?: string }[] } };
      const code = err.cause?.code ?? err.cause?.errors?.[0]?.code ?? err.name ?? 'network_error';
      const detail = `${code} ${err.cause?.message ?? ''}`;
      // The URL itself is unusable (e.g. a port fetch refuses): configuration error, never retried.
      if (/bad port|invalid url|unsupported protocol/i.test(detail)) {
        throw new ProviderError('permanent', 'invalid_endpoint', `Resend endpoint unusable (${sanitize(err.cause?.message ?? code)})`);
      }
      // Refused/unresolvable: nothing reached Resend, so retrying cannot duplicate.
      if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH/.test(detail)) {
        throw new ProviderError('retryable', 'network_unreachable', `Resend unreachable (${sanitize(code)})`);
      }
      // A timeout or a dropped connection after the request was sent: Resend may have accepted it.
      throw new ProviderError(sending ? 'ambiguous' : 'retryable', 'no_response', `No complete response from Resend (${sanitize(code)}); delivery outcome unknown`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async classify(res: Response, secret: string | null): Promise<ProviderError> {
    const json = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
    const summary = sanitize(`HTTP ${res.status} ${json.name ?? ''}: ${json.message ?? ''}`.trim(), secret);
    if (res.status === 429 || res.status >= 500 || res.status === 409) return new ProviderError('retryable', `http_${res.status}`, summary);
    return new ProviderError('permanent', `http_${res.status}`, summary);
  }
}
