/**
 * Shared API client types.
 *
 * These types describe the request/response surface of the API client and the
 * normalized error envelope returned by the backend. Generated OpenAPI types
 * (see `lib/api/generated.ts`) are layered on top of these primitives.
 */

/** HTTP methods supported by the API client. */
export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

/**
 * Normalized error envelope produced by the backend and surfaced by the client.
 * `details` carries any additional, endpoint-specific context.
 */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

/** Options accepted by `apiFetch`. */
export interface ApiFetchOptions extends Omit<RequestInit, "method" | "body"> {
  /** HTTP method. Defaults to `GET`. */
  method?: HttpMethod;
  /** Request body. Plain objects are JSON-encoded automatically. */
  body?: unknown;
  /** Per-request timeout in milliseconds. Defaults to the client default. */
  timeoutMs?: number;
  /**
   * Whether to retry idempotent requests (GET only) on transient failures.
   * Defaults to `true` for GET requests and is ignored for other methods.
   */
  retry?: boolean;
  /**
   * Whether to attempt a token refresh on a 401 response. Defaults to `true`.
   */
  refreshOn401?: boolean;
  /**
   * Skip auth header injection for this request (e.g. login/refresh calls).
   */
  skipAuth?: boolean;
  /** Correlation id forwarded to the backend via the `X-Request-Id` header. */
  requestId?: string;
}

/**
 * Error codes emitted by the backend error envelope. Kept as a string union so
 * unknown codes can still be handled via the fallback message mapping.
 */
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE_ENTITY"
  | "RATE_LIMITED"
  | "INTERNAL_SERVER_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "UNKNOWN";

/**
 * Shape of the raw backend error envelope before normalization.
 */
export interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  code?: string;
  message?: string;
  details?: unknown;
}

/**
 * Minimal token store contract used by the refresh-on-401 flow.
 */
export interface TokenStore {
  getAccessToken(): string | null | Promise<string | null>;
  getRefreshToken(): string | null | Promise<string | null>;
  setTokens(accessToken: string, refreshToken?: string): void | Promise<void>;
  clearTokens(): void | Promise<void>;
}
