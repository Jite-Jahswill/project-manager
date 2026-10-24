/**
 * Who may do what in customer support (docs/security/support.md §2).
 *
 * Customers: any authenticated user, only for conversations they created.
 * Staff: platform administrators, only through the narrow platform.support.* permissions.
 * The same rules are enforced again by RLS (migration 20261024190000_customer_support).
 */
export const SUPPORT_PERMISSIONS = {
  inbox: 'platform.support.inbox.read',
  assigned: 'platform.support.assigned.access',
  assign: 'platform.support.assign',
  reply: 'platform.support.reply',
  status: 'platform.support.status.manage',
  notes: 'platform.support.notes',
  attachments: 'platform.support.attachments.read',
  audit: 'platform.support.audit.read',
} as const;

export interface StaffAccess {
  userId: string;
  /** Sees every conversation (inbox, unassigned queue, metrics). */
  inbox: boolean;
  /** Sees conversations assigned to them. */
  assigned: boolean;
  assign: boolean;
  reply: boolean;
  status: boolean;
  notes: boolean;
  attachments: boolean;
  audit: boolean;
}

export function staffAccessFrom(userId: string, permissions: ReadonlySet<string>): StaffAccess {
  const has = (k: keyof typeof SUPPORT_PERMISSIONS) => permissions.has(SUPPORT_PERMISSIONS[k]);
  return {
    userId,
    inbox: has('inbox'), assigned: has('assigned'), assign: has('assign'), reply: has('reply'),
    status: has('status'), notes: has('notes'), attachments: has('attachments'), audit: has('audit'),
  };
}

/** Staff visibility of one conversation: the whole inbox, or the conversations assigned to them. */
export function staffCanSee(access: StaffAccess, conversation: { assigneeUserId: string | null }): boolean {
  return access.inbox || (access.assigned && conversation.assigneeUserId === access.userId);
}

export function isSupportStaff(access: StaffAccess): boolean {
  return access.inbox || access.assigned;
}
