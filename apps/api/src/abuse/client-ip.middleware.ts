import type { NextFunction, Response } from 'express';
import type { VentidocRequest } from '../common/request-context';
import { resolveClientIp, TrustedProxies } from './client-ip';

/**
 * Sets req.clientIp, the only client address used anywhere in the API (rate
 * limits, audit events). Express's own `trust proxy` is disabled and req.ip is
 * not used.
 */
export function clientIpMiddleware(trusted: TrustedProxies) {
  return (req: VentidocRequest, _res: Response, next: NextFunction): void => {
    req.clientIp = resolveClientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], trusted);
    next();
  };
}
