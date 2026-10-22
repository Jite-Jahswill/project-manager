import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * API error with a stable machine-readable code. Clients branch on `code`,
 * never on `message`.
 */
export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ statusCode: status, code, message }, status);
  }
}

export const Errors = {
  unauthenticated: () => new ApiError(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Authentication required'),
  invalidCredentials: () => new ApiError(HttpStatus.UNAUTHORIZED, 'invalid_credentials', 'Invalid email or password'),
  // Deliberately identical for "not a member" and "no such organization" to avoid probing.
  forbidden: (message = 'You do not have permission to perform this action') =>
    new ApiError(HttpStatus.FORBIDDEN, 'forbidden', message),
  notFound: (what = 'Resource') => new ApiError(HttpStatus.NOT_FOUND, 'not_found', `${what} not found`),
  conflict: (code: string, message: string) => new ApiError(HttpStatus.CONFLICT, code, message),
  badRequest: (code: string, message: string) => new ApiError(HttpStatus.BAD_REQUEST, code, message),
  stepUpRequired: () =>
    new ApiError(HttpStatus.FORBIDDEN, 'step_up_required', 'Re-enter your password to perform this action'),
  entitlementLimit: (key: string) =>
    new ApiError(HttpStatus.FORBIDDEN, 'entitlement_limit_reached', `Your plan's limit for ${key} has been reached`),
  subscriptionReadOnly: () =>
    new ApiError(HttpStatus.FORBIDDEN, 'subscription_read_only', 'The subscription is inactive; the organization is read-only'),
};
