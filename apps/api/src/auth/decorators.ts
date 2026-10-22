import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'ventidoc:isPublic';
/** Route needs no authenticated session (login, register, password reset, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const AUTH_RATE_LIMITED = 'ventidoc:authRateLimited';
/** Applies the strict per-IP credential-endpoint rate limit. */
export const AuthRateLimited = () => SetMetadata(AUTH_RATE_LIMITED, true);
