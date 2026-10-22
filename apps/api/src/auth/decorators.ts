import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'ventidoc:isPublic';
/** Route needs no authenticated session (login, register, password reset, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const MFA_EXEMPT = 'ventidoc:mfaExempt';
/**
 * Reachable by a password-only session of a user for whom MFA is mandatory but not
 * yet set up (identity, logout, session management, MFA enrollment). Every other
 * authenticated route is closed to such sessions.
 */
export const AllowWithoutMfa = () => SetMetadata(MFA_EXEMPT, true);
