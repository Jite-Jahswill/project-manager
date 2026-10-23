import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTemplate, TEMPLATE_DEFINITIONS, TEMPLATES, TemplateValidationError, validateTemplate } from './templates';

const verify = TEMPLATES.get('auth.verify_email')!;
const ok = { subject: 'Verify {{displayName}}', text: 'Hi {{displayName}} {{link}}', html: '<p>Hi {{displayName}} <a href="{{link}}">verify</a></p>' };

describe('email templates', () => {
  it('every default template is valid for its own definition', () => {
    for (const d of TEMPLATE_DEFINITIONS) expect(() => validateTemplate(d, d.defaults)).not.toThrow();
  });

  it.each([
    ['unknown variable', { ...ok, text: 'Hi {{password}} {{link}}' }, /unknown variable/],
    ['required variable missing in text', { ...ok, text: 'Hi {{displayName}}' }, /required/],
    ['required variable missing in html', { ...ok, html: '<p>Hi</p>' }, /required/],
    ['logic syntax', { ...ok, text: '{{#if x}}{{link}}{{/if}}' }, /unsupported template syntax/],
    ['expression syntax', { ...ok, text: '${process.env.X} {{link}}' }, /unsupported template syntax/],
    ['erb syntax', { ...ok, html: '<% x %>' + ok.html }, /unsupported template syntax/],
    ['script tag', { ...ok, html: ok.html + '<script>alert(1)</script>' }, /unsafe content/],
    ['event handler', { ...ok, html: '<p onclick="x()">{{link}}</p><a href="{{link}}">a</a>' }, /unsafe content/],
    ['javascript url', { ...ok, html: '<a href="javascript:alert(1)">x</a>' + ok.html }, /unsafe content/],
    ['data url', { ...ok, html: '<img src="data:image/png;base64,AA">' + ok.html }, /unsafe content/],
    ['form', { ...ok, html: '<form action="https://x">' + ok.html + '</form>' }, /unsafe content/],
    ['iframe', { ...ok, html: '<iframe src="https://x"></iframe>' + ok.html }, /unsafe content/],
    ['multi-line subject', { ...ok, subject: 'a\nBcc: x@y' }, /single line/],
  ])('rejects %s', (_name, content, msg) => {
    expect(() => validateTemplate(verify, content)).toThrow(TemplateValidationError);
    expect(() => validateTemplate(verify, content)).toThrow(msg);
  });

  it('allows the word "data:" in prose (only data URLs are refused)', () => {
    expect(() => validateTemplate(verify, { ...ok, html: '<p>Your data: safe.</p>' + ok.html })).not.toThrow();
  });

  it('escapes variables in HTML, strips line breaks from subjects, appends the locked footer', () => {
    const r = renderTemplate(TEMPLATES.get('org.invitation')!, TEMPLATES.get('org.invitation')!.defaults, {
      orgName: '<b>Evil & "Co"</b>\r\nBcc: attacker@x', inviterName: "O'Brien", link: 'https://app.example/accept#token=a<b',
    });
    expect(r.html).toContain('&lt;b&gt;Evil &amp; &quot;Co&quot;&lt;/b&gt;');
    expect(r.html).not.toContain('<b>Evil');
    expect(r.html).toContain('O&#39;Brien');
    expect(r.html).toContain('token=a&lt;b');
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.text).toContain('This invitation is personal');
    expect(r.html).toContain('This invitation is personal');
  });

  it('refuses non-http links and missing required variables at render time', () => {
    expect(() => renderTemplate(verify, verify.defaults, { displayName: 'x', link: 'javascript:alert(1)' })).toThrow(/not an http/);
    expect(() => renderTemplate(verify, verify.defaults, { displayName: 'x' })).toThrow(/missing required variable link/);
  });

  it('every security-sensitive template carries a locked footer', () => {
    for (const d of TEMPLATE_DEFINITIONS) expect(d.lockedFooter.length).toBeGreaterThan(20);
  });
});

describe('email event schema', () => {
  it('cannot carry passwords, TOTP or recovery codes, MFA secrets, or session tokens', () => {
    const src = readFileSync(join(__dirname, 'events.ts'), 'utf8');
    const typeBlock = src.slice(src.indexOf('export type EmailEvent'), src.indexOf('export type EmailEventType'));
    // Field names (not event names such as "auth.password_reset").
    const fields = [...typeBlock.matchAll(/([A-Za-z_]+)\??\s*:/g)].map((m) => m[1]);
    expect(fields.length).toBeGreaterThan(10);
    for (const forbidden of [/password/i, /totp/i, /recovery/i, /^secret$|mfaSecret/i, /access_?token/i, /refresh_?token/i]) {
      expect({ forbidden: String(forbidden), fields: fields.filter((f) => forbidden.test(f)) }).toEqual({ forbidden: String(forbidden), fields: [] });
    }
    // The only one-time values allowed in transit are the invitation token and the email setup code.
    const sensitive = [...typeBlock.matchAll(/sensitive:\s*\{([^}]*)\}/g)].flatMap((m) => [...m[1].matchAll(/([A-Za-z_]+)\s*:/g)].map((x) => x[1]));
    expect(sensitive.sort()).toEqual(['code', 'invitationToken']);
  });
});
