/**
 * Typed email business events: the only way modules request email. Modules never talk
 * to a provider (docs/architecture/08-email-platform.md).
 *
 * Forbidden in any event (enforced by events.spec.ts): passwords, TOTP codes, recovery
 * codes, MFA secrets, access tokens, refresh tokens. The only secrets that may travel
 * are one-time link tokens and email setup codes, and only in `sensitive` (encrypted at
 * rest, wiped after delivery).
 */
export const SECURITY_NOTICES = [
  'mfa_enabled', 'mfa_replaced', 'mfa_disabled', 'recovery_codes_regenerated', 'recovery_code_used',
  'mfa_recovery_requested', 'mfa_recovery_executed',
] as const;
export type SecurityNotice = (typeof SECURITY_NOTICES)[number];

export type EmailEvent =
  /** Intent: the worker resolves the user and has the auth subsystem create the token at send time. */
  | { type: 'auth.verify_email'; userId: string }
  | { type: 'auth.verify_email_resend'; email: string }
  | { type: 'auth.password_reset'; email: string }
  | { type: 'auth.signup_attempt'; email: string }
  | { type: 'org.invitation'; organizationId: string; email: string; orgName: string; inviterName: string; sensitive: { invitationToken: string } }
  | { type: 'mfa.enrollment_code'; userId: string; sensitive: { code: string } }
  | { type: 'security.notice'; userId: string; notice: SecurityNotice; remaining?: number }
  | { type: 'platform.test'; to: string; requestedBy: string };

export type EmailEventType = EmailEvent['type'];

/** How long a job may wait before it is pointless (and is expired, unsent). */
export const EVENT_TTL_MS: Record<EmailEventType, number> = {
  'auth.verify_email': 24 * 3600_000,
  'auth.verify_email_resend': 24 * 3600_000,
  'auth.password_reset': 3600_000,
  'auth.signup_attempt': 24 * 3600_000,
  'org.invitation': 7 * 24 * 3600_000,
  'mfa.enrollment_code': 10 * 60_000,
  'security.notice': 7 * 24 * 3600_000,
  'platform.test': 3600_000,
};

export function templateKeyFor(event: EmailEvent): string {
  switch (event.type) {
    case 'auth.verify_email':
    case 'auth.verify_email_resend':
      return 'auth.verify_email';
    case 'security.notice':
      return `security.${event.notice}`;
    default:
      return event.type;
  }
}
