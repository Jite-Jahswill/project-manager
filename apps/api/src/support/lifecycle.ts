/**
 * Conversation lifecycle (docs/architecture/09-support.md §3). Mirrors the database function
 * app_support_status_transition_ok(); a test compares the two over every pair.
 *
 *   NEW ──staff reply──► PENDING_CUSTOMER ◄──staff reply── OPEN / PENDING_SUPPORT
 *    │                        │ customer reply                 ▲
 *    │                        ▼                                │ staff (status.manage)
 *    └──────────────► PENDING_SUPPORT ───────────────► RESOLVED ──► CLOSED (terminal)
 *                                 ▲ customer reply or reopen │
 *                                 └──────────────────────────┘
 */
export const SUPPORT_STATUSES = ['NEW', 'OPEN', 'PENDING_CUSTOMER', 'PENDING_SUPPORT', 'RESOLVED', 'CLOSED'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const SUPPORT_CATEGORIES = ['ACCOUNT', 'BILLING', 'TECHNICAL', 'FEATURE_REQUEST', 'OTHER'] as const;

const TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  NEW: ['OPEN', 'PENDING_CUSTOMER', 'PENDING_SUPPORT', 'RESOLVED', 'CLOSED'],
  OPEN: ['PENDING_CUSTOMER', 'PENDING_SUPPORT', 'RESOLVED', 'CLOSED'],
  PENDING_CUSTOMER: ['OPEN', 'PENDING_SUPPORT', 'RESOLVED', 'CLOSED'],
  PENDING_SUPPORT: ['OPEN', 'PENDING_CUSTOMER', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'PENDING_CUSTOMER', 'PENDING_SUPPORT', 'CLOSED'],
  CLOSED: [],
};

export function canTransition(from: SupportStatus, to: SupportStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

/** Thrown for a message to a closed conversation: the customer must open a new one. */
export class ConversationClosedError extends Error {}

/**
 * Status after a customer message. Explicit rule: a reply reopens a RESOLVED conversation
 * (back to support); a CLOSED one cannot be reopened. NEW stays NEW until support engages.
 */
export function statusAfterCustomerMessage(current: SupportStatus): SupportStatus {
  if (current === 'CLOSED') throw new ConversationClosedError();
  return current === 'NEW' ? 'NEW' : 'PENDING_SUPPORT';
}

/** Status after a support reply: waiting on the customer. */
export function statusAfterStaffReply(current: SupportStatus): SupportStatus {
  if (current === 'CLOSED') throw new ConversationClosedError();
  return 'PENDING_CUSTOMER';
}

/** Customers may explicitly reopen only a RESOLVED conversation. */
export function customerMayReopen(current: SupportStatus): boolean {
  return current === 'RESOLVED';
}

/** Customer-visible preview: single line, at most 140 characters. Never built from internal notes. */
export function previewOf(body: string): string {
  const line = body.replace(/\s+/g, ' ').trim();
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}
