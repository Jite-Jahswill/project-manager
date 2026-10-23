import { CaptureAdapter, LogAdapter } from './dev.adapters';
import { ResendAdapter } from './resend.adapter';
import { SmtpAdapter } from './smtp.adapter';
import { EmailProviderAdapter, ProviderKind } from './types';

/** Extension point: add a provider here; nothing else in the application changes. */
const ADAPTERS: Record<ProviderKind, EmailProviderAdapter> = {
  RESEND: new ResendAdapter() as EmailProviderAdapter,
  SMTP: new SmtpAdapter() as EmailProviderAdapter,
  LOG: new LogAdapter() as EmailProviderAdapter,
  CAPTURE: new CaptureAdapter() as EmailProviderAdapter,
};

export function adapterFor(kind: string): EmailProviderAdapter {
  const a = ADAPTERS[kind as ProviderKind];
  if (!a) throw new Error(`Unknown email provider ${kind}`);
  return a;
}

/** Providers that deliver real mail (and therefore need verification before sending is enabled). */
export function isRealProvider(kind: string): boolean {
  return kind === 'RESEND' || kind === 'SMTP';
}
