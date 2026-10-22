import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../config/env';

export const ACCESS_COOKIE = 'vd_at';
export const REFRESH_COOKIE = 'vd_rt';
/** Readable by the web app's JS and echoed in the x-csrf-token header (double-submit). */
export const CSRF_COOKIE = 'vd_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export { DEVICE_COOKIE } from '../abuse/device-token.service';
import { DEVICE_COOKIE, DEVICE_TOKEN_MAX_AGE_SECONDS } from '../abuse/device-token.service';

function base(config: AppConfig): CookieOptions {
  return { secure: config.nodeEnv !== 'development', path: '/' };
}

export function setAuthCookies(
  res: Response,
  config: AppConfig,
  tokens: { accessToken: string; refreshToken: string; csrfToken: string; refreshExpiresAt: Date },
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(config),
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.jwtAccessTtlSeconds * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(config),
    httpOnly: true,
    sameSite: 'strict',
    path: '/v1/auth',
    expires: tokens.refreshExpiresAt,
  });
  res.cookie(CSRF_COOKIE, tokens.csrfToken, {
    ...base(config),
    httpOnly: false,
    sameSite: 'strict',
    expires: tokens.refreshExpiresAt,
  });
}

/** "Known device" marker for login rate limiting; carries no authority. Survives logout on purpose. */
export function setDeviceCookie(res: Response, config: AppConfig, deviceToken: string): void {
  res.cookie(DEVICE_COOKIE, deviceToken, {
    ...base(config),
    httpOnly: true,
    sameSite: 'strict',
    path: '/v1/auth',
    maxAge: DEVICE_TOKEN_MAX_AGE_SECONDS * 1000,
  });
}

export function clearAuthCookies(res: Response, config: AppConfig): void {
  res.clearCookie(ACCESS_COOKIE, base(config));
  res.clearCookie(REFRESH_COOKIE, { ...base(config), path: '/v1/auth' });
  res.clearCookie(CSRF_COOKIE, base(config));
}
