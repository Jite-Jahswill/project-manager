import { Logger } from '@nestjs/common';
import { EmailProviderAdapter, OutgoingEmail, SettingsValidationError } from './types';

export interface CapturedEmail {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
}

/** Process-wide capture sink used by tests (every in-process worker writes here). */
export const capturedEmails: CapturedEmail[] = [];

abstract class DevAdapter implements EmailProviderAdapter<Record<string, never>> {
  abstract readonly kind: 'LOG' | 'CAPTURE';
  readonly requiresSecret = false;
  validateSettings(raw: unknown, production: boolean): Record<string, never> {
    if (production) throw new SettingsValidationError(`${this.kind} is a development provider and is refused in production`);
    if (raw && Object.keys(raw as object).length) throw new SettingsValidationError(`${this.kind} takes no settings`);
    return {};
  }
  validateSecret(): void {
    throw new SettingsValidationError(`${this.kind} takes no credentials`);
  }
  secretHint(): string {
    return '';
  }
  async check() {
    return { ok: true, summary: `${this.kind} provider (development only)`, domainVerified: null };
  }
  abstract send(m: OutgoingEmail): Promise<{ messageId: string | null }>;
}

/** Development: prints messages (including links and codes) to the API log. Refused in production. */
export class LogAdapter extends DevAdapter {
  readonly kind = 'LOG' as const;
  private readonly logger = new Logger('DevMail');
  async send(m: OutgoingEmail) {
    this.logger.log(`[dev mail] to=${m.to} subject="${m.subject}"\n${m.text}`);
    return { messageId: `log-${m.idempotencyKey}` };
  }
}

/** Tests: records messages in memory. Refused in production. */
export class CaptureAdapter extends DevAdapter {
  readonly kind = 'CAPTURE' as const;
  async send(m: OutgoingEmail) {
    capturedEmails.push({ to: m.to, from: `${m.from.name} <${m.from.email}>`, replyTo: m.replyTo, subject: m.subject, text: m.text, html: m.html, idempotencyKey: m.idempotencyKey });
    return { messageId: `capture-${m.idempotencyKey}` };
  }
}
