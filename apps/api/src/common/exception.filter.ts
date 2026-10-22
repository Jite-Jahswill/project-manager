import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import type { VentidocRequest } from './request-context';

/**
 * Maps errors to safe HTTP responses. Database details (constraint names, SQL,
 * row contents) never reach the client.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<VentidocRequest>();

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      res.status(exception.getStatus()).json(typeof body === 'string' ? { statusCode: exception.getStatus(), message: body } : body);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaError(exception);
      if (mapped) {
        res.status(mapped.status).json({ statusCode: mapped.status, code: mapped.code, message: mapped.message });
        return;
      }
    }

    this.logger.error(
      `Unhandled error on ${req.method} ${req.route?.path ?? '(unmatched route)'} requestId=${req.requestId}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, code: 'internal_error', message: 'Internal server error' });
  }
}

function mapPrismaError(e: Prisma.PrismaClientKnownRequestError): { status: number; code: string; message: string } | null {
  switch (e.code) {
    case 'P2002':
      return { status: 409, code: 'already_exists', message: 'A record with these values already exists' };
    case 'P2003':
      // Includes composite (id, organization_id) FK failures: a reference to another tenant's row.
      return { status: 400, code: 'invalid_reference', message: 'A referenced record does not exist' };
    case 'P2025':
      return { status: 404, code: 'not_found', message: 'Resource not found' };
    default:
      return null;
  }
}
