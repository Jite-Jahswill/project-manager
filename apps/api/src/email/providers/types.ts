/**
 * Provider adapter contract. Authentication and business modules never see this; only
 * the delivery worker and the admin configuration service do. New providers implement
 * this interface and register in providers/registry.ts.
 */
export type ProviderKind = 'RESEND' | 'SMTP' | 'LOG' | 'CAPTURE';

export interface OutgoingEmail {
  from: { email: string; name: string };
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Stable per outbox job; passed to providers that support idempotent sends. */
  idempotencyKey: string;
}

export interface ProviderContext<S = unknown> {
  settings: S;
  /** Decrypted credential, if the provider needs one. Never logged. */
  secret: string | null;
  production: boolean;
}

/**
 * retryable  - definitely not accepted; safe to retry (network refused, 429, 5xx, SMTP 4xx)
 * permanent  - will not succeed by retrying (validation, authentication, SMTP 5xx)
 * ambiguous  - the provider may have accepted it (timeout after the request was sent)
 */
export type FailureKind = 'retryable' | 'permanent' | 'ambiguous';

export class ProviderError extends Error {
  constructor(readonly kind: FailureKind, readonly code: string, readonly summary: string) {
    super(summary);
  }
}

export class SettingsValidationError extends Error {}

export interface CheckResult {
  ok: boolean;
  /** Sanitized, safe to store and show to administrators. */
  summary: string;
  /** true/false when the provider can tell whether the sender domain is verified; null otherwise. */
  domainVerified: boolean | null;
}

export interface EmailProviderAdapter<S = unknown> {
  readonly kind: ProviderKind;
  readonly requiresSecret: boolean;
  /** Validates and normalizes non-secret settings. Throws SettingsValidationError. */
  validateSettings(raw: unknown, production: boolean): S;
  /** Validates the shape of a credential before it is stored. Throws SettingsValidationError. */
  validateSecret(secret: string): void;
  /** Safe indicator shown after the secret is saved (never the secret itself). */
  secretHint(secret: string): string;
  send(message: OutgoingEmail, ctx: ProviderContext<S>): Promise<{ messageId: string | null }>;
  check(ctx: ProviderContext<S>, senderDomain: string | null): Promise<CheckResult>;
}

/** Removes anything that could be a credential from text that will be stored or shown. */
export function sanitize(text: string, secret: string | null = null): string {
  let s = String(text ?? '').replace(/re_[A-Za-z0-9_]{6,}/g, 're_[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  if (secret && secret.length >= 4) s = s.split(secret).join('[redacted]');
  return s.replace(/[\r\n\t]+/g, ' ').slice(0, 300);
}

export function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}
