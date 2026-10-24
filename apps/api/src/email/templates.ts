/**
 * Email template definitions and the safe renderer.
 *
 * Administrators may edit subject/text/HTML of each template (versioned in
 * email_templates), but:
 *  - the only syntax is {{variable}}; unknown variables, any other braces or logic are rejected;
 *  - every variable is HTML-escaped in HTML; subjects cannot contain line breaks;
 *  - required variables (the security link or code) must stay in both text and HTML;
 *  - active content (script, event handlers, javascript:/data: URLs, forms, iframes...) is rejected;
 *  - each template has a locked security footer appended by the system, not editable.
 * Tokens are produced by the auth subsystem; templates only place them.
 */
import { SECURITY_NOTICES } from './events';

export type VarKind = 'text' | 'url' | 'code' | 'number';

export interface TemplateDefinition {
  key: string;
  description: string;
  variables: Record<string, VarKind>;
  required: string[];
  /** Appended by the system to text and HTML; administrators cannot remove or edit it. */
  lockedFooter: string;
  defaults: { subject: string; text: string; html: string };
}

const SECURITY_FOOTER = 'If this wasn\'t you, reset your password and contact Ventidoc support immediately. Ventidoc will never ask for your password or codes.';
const SUPPORT_FOOTER = 'Ventidoc support will never ask for your password or verification codes. Reply only through the Ventidoc app.';
const STAFF_FOOTER = 'Internal notification for Ventidoc support staff. Do not forward: open the conversation in the Ventidoc console.';
const html = (body: string) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">${body}</div>`;

const NOTICE_TEXT: Record<(typeof SECURITY_NOTICES)[number], { subject: string; body: string }> = {
  mfa_enabled: { subject: 'Two-step verification is on', body: 'Two-step verification was turned on for your Ventidoc account. Your other sessions were signed out.' },
  mfa_replaced: { subject: 'Your two-step verification device changed', body: 'The authenticator for your Ventidoc account was replaced. Your other sessions were signed out.' },
  mfa_disabled: { subject: 'Two-step verification was turned off', body: 'Two-step verification was turned off for your Ventidoc account.' },
  recovery_codes_regenerated: { subject: 'New recovery codes were generated', body: 'New two-step verification recovery codes were generated. Your previous codes no longer work.' },
  recovery_code_used: { subject: 'A recovery code was used', body: 'A recovery code was used to sign in to your Ventidoc account. {{remaining}} recovery code(s) remain.' },
  mfa_recovery_requested: { subject: 'Two-step verification recovery was requested', body: 'A request to reset two-step verification on your Ventidoc account was opened by Ventidoc support. If you did not contact support, reply immediately.' },
  mfa_recovery_executed: { subject: 'Your two-step verification was reset', body: 'Two-step verification on your Ventidoc account was reset by Ventidoc support after a second administrator approved it. All your sessions were signed out.' },
};

export const TEMPLATE_DEFINITIONS: readonly TemplateDefinition[] = [
  {
    key: 'auth.verify_email',
    description: 'Email address verification link',
    variables: { displayName: 'text', link: 'url' },
    required: ['link'],
    lockedFooter: 'If you did not create a Ventidoc account, you can ignore this email. This link expires in 24 hours.',
    defaults: {
      subject: 'Verify your Ventidoc email',
      text: 'Hello {{displayName}},\n\nConfirm your email address: {{link}}',
      html: html('<p>Hello {{displayName}},</p><p><a href="{{link}}">Confirm your email address</a></p>'),
    },
  },
  {
    key: 'auth.password_reset',
    description: 'Password reset link',
    variables: { displayName: 'text', link: 'url' },
    required: ['link'],
    lockedFooter: 'If you did not request a password reset, ignore this email; your password will not change. This link expires in 1 hour. Never share it.',
    defaults: {
      subject: 'Reset your Ventidoc password',
      text: 'Hello {{displayName}},\n\nReset your password: {{link}}',
      html: html('<p>Hello {{displayName}},</p><p><a href="{{link}}">Reset your password</a></p>'),
    },
  },
  {
    key: 'auth.signup_attempt',
    description: 'Someone tried to register with an existing address',
    variables: {},
    required: [],
    lockedFooter: SECURITY_FOOTER,
    defaults: {
      subject: 'Ventidoc sign-up attempt',
      text: 'Someone tried to create a Ventidoc account with this email address. If it was you, sign in or reset your password.',
      html: html('<p>Someone tried to create a Ventidoc account with this email address. If it was you, sign in or reset your password.</p>'),
    },
  },
  {
    key: 'org.invitation',
    description: 'Organization invitation link',
    variables: { orgName: 'text', inviterName: 'text', link: 'url' },
    required: ['link'],
    lockedFooter: 'This invitation is personal and expires in 7 days. If you were not expecting it, ignore this email.',
    defaults: {
      subject: "You're invited to {{orgName}} on Ventidoc",
      text: '{{inviterName}} invited you to join {{orgName}} on Ventidoc.\n\nAccept the invitation: {{link}}',
      html: html('<p>{{inviterName}} invited you to join <strong>{{orgName}}</strong> on Ventidoc.</p><p><a href="{{link}}">Accept the invitation</a></p>'),
    },
  },
  {
    key: 'mfa.enrollment_code',
    description: 'One-time code to confirm the first two-step verification setup',
    variables: { code: 'code' },
    required: ['code'],
    lockedFooter: 'This code expires in 10 minutes. Ventidoc will never ask you for it by phone or chat. If you did not request it, change your password now.',
    defaults: {
      subject: 'Your Ventidoc two-step verification setup code',
      text: 'Enter this code to finish setting up two-step verification: {{code}}',
      html: html('<p>Enter this code to finish setting up two-step verification:</p><p style="font-size:22px;letter-spacing:4px"><strong>{{code}}</strong></p>'),
    },
  },
  ...SECURITY_NOTICES.map((notice): TemplateDefinition => ({
    key: `security.${notice}`,
    description: `Security notice: ${notice.replace(/_/g, ' ')}`,
    variables: notice === 'recovery_code_used' ? { remaining: 'number' } : {},
    required: [],
    lockedFooter: SECURITY_FOOTER,
    defaults: { subject: NOTICE_TEXT[notice].subject, text: NOTICE_TEXT[notice].body, html: html(`<p>${NOTICE_TEXT[notice].body}</p>`) },
  })),
  // Support: subjects and bodies name only the public reference. No message text, internal
  // notes or staff names ever appear in email (docs/security/support.md).
  {
    key: 'support.reply',
    description: 'Support replied to the customer',
    variables: { reference: 'text', link: 'url' },
    required: ['link'],
    lockedFooter: SUPPORT_FOOTER,
    defaults: {
      subject: 'New reply to your support request {{reference}}',
      text: 'Ventidoc support replied to your request {{reference}}.\n\nRead the reply: {{link}}',
      html: html('<p>Ventidoc support replied to your request {{reference}}.</p><p><a href="{{link}}">Read the reply</a></p>'),
    },
  },
  {
    key: 'support.status_changed',
    description: 'A support request was resolved or closed',
    variables: { reference: 'text', statusLabel: 'text', link: 'url' },
    required: ['link'],
    lockedFooter: SUPPORT_FOOTER,
    defaults: {
      subject: 'Your support request {{reference}} was {{statusLabel}}',
      text: 'Your support request {{reference}} was {{statusLabel}}.\n\nView it: {{link}}',
      html: html('<p>Your support request {{reference}} was {{statusLabel}}.</p><p><a href="{{link}}">View it</a></p>'),
    },
  },
  {
    key: 'support.customer_message',
    description: 'A customer wrote in a conversation assigned to the recipient',
    variables: { reference: 'text', link: 'url' },
    required: ['link'],
    lockedFooter: STAFF_FOOTER,
    defaults: {
      subject: 'New customer message on {{reference}}',
      text: 'The customer wrote a new message on {{reference}}.\n\nOpen the conversation: {{link}}',
      html: html('<p>The customer wrote a new message on {{reference}}.</p><p><a href="{{link}}">Open the conversation</a></p>'),
    },
  },
  {
    key: 'support.assigned',
    description: 'A support conversation was assigned to the recipient',
    variables: { reference: 'text', link: 'url' },
    required: ['link'],
    lockedFooter: STAFF_FOOTER,
    defaults: {
      subject: 'Support conversation {{reference}} was assigned to you',
      text: 'The support conversation {{reference}} was assigned to you.\n\nOpen the conversation: {{link}}',
      html: html('<p>The support conversation {{reference}} was assigned to you.</p><p><a href="{{link}}">Open the conversation</a></p>'),
    },
  },
  {
    key: 'platform.test',
    description: 'Administrator test email',
    variables: {},
    required: [],
    lockedFooter: 'This is a test message sent by a Ventidoc platform administrator.',
    defaults: {
      subject: 'Ventidoc email test',
      text: 'This is a test email from Ventidoc. If you received it, the active provider and sender identity work.',
      html: html('<p>This is a test email from Ventidoc. If you received it, the active provider and sender identity work.</p>'),
    },
  },
];

export const TEMPLATES: ReadonlyMap<string, TemplateDefinition> = new Map(TEMPLATE_DEFINITIONS.map((t) => [t.key, t]));

export class TemplateValidationError extends Error {}

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const FORBIDDEN_HTML = [
  /<\s*script/i, /<\s*iframe/i, /<\s*object/i, /<\s*embed/i, /<\s*form/i, /<\s*input/i, /<\s*base/i, /<\s*link/i,
  /<\s*meta/i, /<\s*svg/i, /<\s*math/i, /\son[a-z]+\s*=/i, /javascript\s*:/i, /vbscript\s*:/i,
  /(href|src|action|background|poster|srcset)\s*=\s*["']?\s*data\s*:/i, /url\(\s*["']?\s*data\s*:/i, /expression\s*\(/i, /@import/i,
];
const MAX_SUBJECT = 200;
const MAX_BODY = 50_000;

function placeholders(s: string): string[] {
  return [...s.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

export interface TemplateContent {
  subject: string;
  text: string;
  html: string;
}

/** Validates administrator-edited content for `def`. Throws TemplateValidationError with a precise reason. */
export function validateTemplate(def: TemplateDefinition, c: TemplateContent): void {
  if (!c.subject.trim() || c.subject.length > MAX_SUBJECT || /[\r\n]/.test(c.subject)) {
    throw new TemplateValidationError(`subject must be a single line of 1-${MAX_SUBJECT} characters`);
  }
  for (const [name, body] of [['text', c.text], ['html', c.html]] as const) {
    if (!body.trim() || body.length > MAX_BODY) throw new TemplateValidationError(`${name} must be 1-${MAX_BODY} characters`);
  }
  for (const [name, body] of [['subject', c.subject], ['text', c.text], ['html', c.html]] as const) {
    // After removing valid placeholders, no template syntax may remain (no logic, no helpers).
    if (/\{\{|\}\}|\{%|%\}|<%|%>|\$\{/.test(body.replace(PLACEHOLDER, ''))) {
      throw new TemplateValidationError(`${name} contains unsupported template syntax; only {{variable}} is allowed`);
    }
    for (const v of placeholders(body)) {
      if (!(v in def.variables)) throw new TemplateValidationError(`${name} uses unknown variable {{${v}}}; allowed: ${Object.keys(def.variables).join(', ') || 'none'}`);
    }
  }
  for (const v of def.required) {
    if (!placeholders(c.text).includes(v) || !placeholders(c.html).includes(v)) {
      throw new TemplateValidationError(`{{${v}}} is required in both the text and the HTML version`);
    }
  }
  for (const pattern of FORBIDDEN_HTML) {
    if (pattern.test(c.html)) throw new TemplateValidationError('html contains active or unsafe content (scripts, handlers, forms, embedded or data/javascript URLs)');
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Removes control characters (except tab and newline) from variable values. */
const stripControl = (s: string) => [...s].filter((ch) => {
  const c = ch.charCodeAt(0);
  return c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127);
}).join('');

export type RenderedEmail = TemplateContent;

/** Renders validated content with variables; appends the locked security footer. */
export function renderTemplate(def: TemplateDefinition, c: TemplateContent, vars: Record<string, string | number | undefined>): RenderedEmail {
  for (const v of def.required) {
    if (vars[v] === undefined || vars[v] === '') throw new TemplateValidationError(`missing required variable ${v}`);
  }
  const value = (name: string) => {
    const raw = vars[name];
    if (raw === undefined) return '';
    const s = stripControl(String(raw));
    if (def.variables[name] === 'url' && !/^https?:\/\//.test(s)) throw new TemplateValidationError(`variable ${name} is not an http(s) URL`);
    return s;
  };
  const subject = c.subject.replace(PLACEHOLDER, (_, n: string) => value(n).replace(/[\r\n]+/g, ' ')).slice(0, 250);
  const text = `${c.text.replace(PLACEHOLDER, (_, n: string) => value(n))}\n\n--\n${def.lockedFooter}\n`;
  const htmlBody = `${c.html.replace(PLACEHOLDER, (_, n: string) => escapeHtml(value(n)))}`
    + `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-family:Arial,sans-serif;font-size:12px;color:#6b7280">${escapeHtml(def.lockedFooter)}</p>`;
  return { subject, text, html: htmlBody };
}

/** Sample values for previews (never real tokens). */
export function sampleVariables(def: TemplateDefinition): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [name, kind] of Object.entries(def.variables)) {
    out[name] = kind === 'url' ? 'https://example.invalid/preview#token=PREVIEW' : kind === 'code' ? '00000000' : kind === 'number' ? 3 : `Sample ${name}`;
  }
  return out;
}
