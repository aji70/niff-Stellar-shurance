import { HttpException } from '@nestjs/common';
import { ERROR_CATALOG, ErrorCode, getCatalogEntry } from './error-catalog';

/**
 * AppException — typed exception backed by the error catalog.
 *
 * Usage:
 *   throw new AppException('CLAIM_NOT_FOUND');
 *   throw new AppException('RATE_LIMIT_EXCEEDED', { details: { retryAfter: 30 } });
 *
 * The code MUST exist in ERROR_CATALOG. TypeScript enforces this at compile time.
 * The CI check (scripts/check-error-codes.ts) enforces it for dynamic usages.
 */
export class AppException extends HttpException {
  readonly errorCode: ErrorCode;

  constructor(code: ErrorCode, extra?: { message?: string; details?: unknown }) {
    const entry = ERROR_CATALOG[code];
    super(
      {
        statusCode: entry.httpStatus,
        error: entry.code,
        message: extra?.message ?? entry.description,
        i18nKey: entry.i18nKey,
        ...(extra?.details !== undefined ? { details: extra.details } : {}),
      },
      entry.httpStatus,
    );
    this.errorCode = code;
  }
}

/**
 * Attempt to resolve a raw error code string to a catalog entry at runtime.
 * Used by the exception filter to handle legacy throw sites that pass plain strings.
 */
export function resolveErrorCode(code: string): ErrorCode | undefined {
  const entry = getCatalogEntry(code);
  return entry ? (code as ErrorCode) : undefined;
}
