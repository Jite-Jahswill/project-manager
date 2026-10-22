import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { VentidocRequest } from './request-context';

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function requestIdMiddleware(req: VentidocRequest, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
