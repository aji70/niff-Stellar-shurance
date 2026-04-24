import { HttpException, HttpStatus } from '@nestjs/common';

export interface RateLimitErrorDetails {
  policyId: string;
  currentCount: number;
  limit: number;
  windowResetLedger: number;
  remainingLedgers: number;
  /** Seconds until the client should retry */
  retryAfterSeconds?: number;
  /** Type of limit that was exceeded */
  limitType?: 'policy' | 'wallet' | 'global';
}

export class RateLimitException extends HttpException {
  constructor(details: RateLimitErrorDetails) {
    const typeLabel = details.limitType ?? 'policy';
    const message =
      `Rate limit exceeded for ${typeLabel} ${details.policyId}. ` +
      `Current: ${details.currentCount}/${details.limit}. ` +
      `Window resets in ${details.remainingLedgers} ledgers (ledger ${details.windowResetLedger}).`;

    const responseBody: Record<string, unknown> = {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'Too Many Requests',
      message,
      details,
    };

    if (details.retryAfterSeconds && details.retryAfterSeconds > 0) {
      responseBody.retryAfter = details.retryAfterSeconds;
    }

    super(responseBody, HttpStatus.TOO_MANY_REQUESTS);
  }
}
