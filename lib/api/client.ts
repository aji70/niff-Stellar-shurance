import { env } from "@/lib/env";

/**
 * Typed API client for all backend calls.
 *
 * - Base URL from env
 * - JSON handling
 * - Auth header injection
 * - Request ids
 * - AbortController timeouts
 * - Retry on idempotent GET only
 * - Backend error envelope -> typed ApiError
 * - Token refresh-on-401 (runs once) with request queuing
 *
 * Usable from both server and client components.
 */

export interface ApiErrorDetails {
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ApiErrorDetails;

  constructor(code: string, message: string, status: number, details?: ApiErrorDetails) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Shape of the backend error envelope. */
interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: ApiErrorDetails;
  };
  code?: string;
  message?: string;
  details?: ApiErrorDetails;
}

/**
 * Maps backend error codes to translated user messages.
 * Falls back to the envelope message, then to a generic message.
 */
const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "You are not authorized. Please sign in again.",
  forbidden: "You do not have permission to perform this action.",
  not_found: "The requested resource was not found.",
  validation_error: "Please check the submitted data and try again.",
  rate_limited: "Too many requests. Please try again later.",
  internal_error: "Something went wrong. Please try again.",
};

const FALLBACK_MESSAGE = "Something went wrong. Please try again.";

export function mapErrorMessage(code: string | undefined, fallback?: string): string {
  if (code && ERROR_MESSAGES[code]) {
    return ERROR_MESSAGES[code];
  }
  return fallback || FALLBACK_MESSAGE;
}

function parseErrorEnvelope(body: unknown): ErrorEnvelope {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const nested = record.error;
    if (nested && typeof nested === "object") {
      return nested as ErrorEnvelope;
    }
    return record as ErrorEnvelope;
  }
  return {};
}

function toApiError(status: number, body: unknown): ApiError {
  const envelope = parseErrorEnvelope(body);
  const code = envelope.code || (status === 401 ? "unauthorized" : "internal_error");
  const message = mapErrorMessage(code, envelope.message);
  return new ApiError(code, message, status, envelope.details);
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_GET_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 300;

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Registers the refresh handler. It must return a new access token or null.
 * The handler is invoked at most once per 401 burst; concurrent callers queue
 * on the same promise.
 */
export function setRefreshHandler(handler: (() => Promise<string | null>) | null): void {
  onUnauthorized = handler;
}

function refreshTokenOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (onUnauthorized ? onUnauthorized() : Promise.resolve(null))
      .then((token) => {
        accessToken = token;
        return token;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  /** JSON-serializable request body. */
  body?: unknown;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Skip auth header injection (e.g. for public endpoints). */
  skipAuth?: boolean;
  /** Skip the refresh-on-401 flow for this request. */
  skipRefresh?: boolean;
}

function buildUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  const base = env.NEXT_PUBLIC_API_BASE_URL.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }
  const text = await response.text();
  return text || undefined;
}

async function executeRequest(
  url: string,
  method: string,
  options: ApiFetchOptions,
  requestId: string,
  token: string | null,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Request-Id", requestId);
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !options.skipAuth) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  try {
    return await fetch(url, {
      ...options,
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: options.cache ?? "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Core fetch wrapper. Returns the parsed JSON body typed as T.
 * Throws ApiError on non-2xx responses or timeouts.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const isIdempotentGet = method === "GET";
  const url = buildUrl(path);
  const requestId = generateRequestId();

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let response: Response;
    try {
      response = await executeRequest(url, method, options, requestId, accessToken);
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      if (isAbort) {
        throw new ApiError("timeout", "The request timed out. Please try again.", 408);
      }
      if (isIdempotentGet && attempt < MAX_GET_RETRIES) {
        attempt += 1;
        await delay(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw new ApiError("network_error", "Network error. Please check your connection.", 0);
    }

    if (response.status === 401 && !options.skipRefresh && onUnauthorized) {
      const newToken = await refreshTokenOnce();
      if (newToken) {
        // Retry once with the refreshed token.
        response = await executeRequest(url, method, options, requestId, newToken);
      }
    }

    if (response.ok) {
      return (await parseBody(response)) as T;
    }

    // Retry idempotent GETs on transient server errors only.
    if (isIdempotentGet && response.status >= 500 && attempt < MAX_GET_RETRIES) {
      attempt += 1;
      await delay(RETRY_BASE_DELAY_MS * attempt);
      continue;
    }

    const body = await parseBody(response);
    throw toApiError(response.status, body);
  }
}

export const api = {
  get: <T>(path: string, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: "POST", body }),
  put: <T>(path: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: "PUT", body }),
  patch: <T>(path: string, body?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: "DELETE" }),
};
