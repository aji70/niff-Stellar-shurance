/**
 * Typed error surface for the API client.
 *
 * The backend returns a JSON error envelope of the shape:
 *   { code: string, message: string, details?: unknown }
 *
 * `ApiError` normalises that envelope (and any transport-level failure) into a
 * single typed shape that callers and UI can rely on.
 */

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiErrorKind =
  | "http"
  | "timeout"
  | "network"
  | "parse"
  | "aborted";

export interface ApiErrorOptions {
  status?: number;
  kind?: ApiErrorKind;
  details?: unknown;
  cause?: unknown;
}

/**
 * Error thrown by `apiFetch` for every non-2xx response and transport failure.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: unknown;
  readonly kind: ApiErrorKind;
  override readonly cause?: unknown;

  constructor(
    code: string,
    message: string,
    options: ApiErrorOptions = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = options.status;
    this.details = options.details;
    this.kind = options.kind ?? "http";
    this.cause = options.cause;
  }

  static fromEnvelope(
    envelope: ApiErrorEnvelope,
    status?: number,
  ): ApiError {
    return new ApiError(envelope.code, envelope.message, {
      status,
      details: envelope.details,
      kind: "http",
    });
  }

  static timeout(message = "Request timed out"): ApiError {
    return new ApiError("TIMEOUT", message, { kind: "timeout" });
  }

  static network(message = "Network request failed", cause?: unknown): ApiError {
    return new ApiError("NETWORK_ERROR", message, { kind: "network", cause });
  }

  static parse(message = "Failed to parse response", cause?: unknown): ApiError {
    return new ApiError("PARSE_ERROR", message, { kind: "parse", cause });
  }

  static aborted(message = "Request aborted"): ApiError {
    return new ApiError("ABORTED", message, { kind: "aborted" });
  }

  toJSON(): ApiErrorEnvelope & { status?: number; kind: ApiErrorKind } {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      status: this.status,
      kind: this.kind,
    };
  }
}

/**
 * Narrowing helper for `unknown` catch values.
 */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * Best-effort detection of the backend error envelope.
 */
export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

/**
 * Fallback message used when an error code has no translation.
 */
export const FALLBACK_ERROR_MESSAGE = "Something went wrong. Please try again.";

/**
 * Default English translations for known backend error codes.
 *
 * Consumers can override or extend these (e.g. via i18n) by passing their own
 * map to `getErrorMessage`.
 */
export const DEFAULT_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "You are not signed in.",
  FORBIDDEN: "You do not have permission to do that.",
  NOT_FOUND: "The requested resource was not found.",
  VALIDATION_ERROR: "Please check the submitted values and try again.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  INTERNAL_ERROR: "Something went wrong on our end. Please try again.",
  TIMEOUT: "The request timed out. Please try again.",
  NETWORK_ERROR: "Network request failed. Check your connection and try again.",
  PARSE_ERROR: "We received an unexpected response. Please try again.",
  ABORTED: "The request was cancelled.",
};

/**
 * Map an error (or raw code) to a translated, user-facing message.
 *
 * Falls back to the error's own message, then to `FALLBACK_ERROR_MESSAGE`.
 */
export function getErrorMessage(
  error: unknown,
  messages: Record<string, string> = DEFAULT_ERROR_MESSAGES,
): string {
  if (isApiError(error)) {
    return messages[error.code] ?? error.message ?? FALLBACK_ERROR_MESSAGE;
  }

  if (typeof error === "string") {
    return messages[error] ?? FALLBACK_ERROR_MESSAGE;
  }

  if (isApiErrorEnvelope(error)) {
    return messages[error.code] ?? error.message ?? FALLBACK_ERROR_MESSAGE;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return FALLBACK_ERROR_MESSAGE;
}
