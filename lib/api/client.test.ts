import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { apiFetch, ApiError, setAuthTokenProvider, setRefreshHandler } from './client';

const BASE = 'http://localhost/api';

const server = setupServer();

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', BASE);
  setAuthTokenProvider(null);
  setRefreshHandler(null);
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  server.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    server.use(
      http.get(`${BASE}/items`, () => HttpResponse.json({ items: [1, 2, 3] })),
    );

    const data = await apiFetch<{ items: number[] }>('/items');
    expect(data).toEqual({ items: [1, 2, 3] });
  });

  it('injects the auth header when a token is available', async () => {
    setAuthTokenProvider(() => 'token-123');
    let seen: string | null = null;
    server.use(
      http.get(`${BASE}/me`, ({ request }) => {
        seen = request.headers.get('authorization');
        return HttpResponse.json({ id: 'u1' });
      }),
    );

    await apiFetch('/me');
    expect(seen).toBe('Bearer token-123');
  });

  it('maps the backend error envelope to ApiError', async () => {
    server.use(
      http.get(`${BASE}/boom`, () =>
        HttpResponse.json(
          { error: { code: 'NOT_FOUND', message: 'missing', details: { id: 7 } } },
          { status: 404 },
        ),
      ),
    );

    await expect(apiFetch('/boom')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NOT_FOUND',
      status: 404,
      details: { id: 7 },
    });
  });

  it('falls back to a generic message for unknown error codes', async () => {
    server.use(
      http.get(`${BASE}/weird`, () =>
        HttpResponse.json({ error: { code: 'SOMETHING_NEW' } }, { status: 400 }),
      ),
    );

    const err = await apiFetch('/weird').catch((e) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('SOMETHING_NEW');
    expect(err.message).toBeTruthy();
  });

  it('aborts the request when the timeout elapses', async () => {
    server.use(
      http.get(`${BASE}/slow`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ ok: true });
      }),
    );

    await expect(apiFetch('/slow', { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('retries idempotent GET requests on transient failures', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/flaky`, () => {
        calls += 1;
        if (calls < 2) return HttpResponse.json({ error: { code: 'UNAVAILABLE' } }, { status: 503 });
        return HttpResponse.json({ ok: true });
      }),
    );

    const data = await apiFetch<{ ok: boolean }>('/flaky', { retries: 1 });
    expect(data).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('does not retry non-idempotent requests', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/items`, () => {
        calls += 1;
        return HttpResponse.json({ error: { code: 'UNAVAILABLE' } }, { status: 503 });
      }),
    );

    await expect(apiFetch('/items', { method: 'POST', retries: 3 })).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  it('refreshes once on 401 and queues concurrent requests', async () => {
    let token = 'expired';
    let refreshCalls = 0;
    setAuthTokenProvider(() => token);
    setRefreshHandler(async () => {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      token = 'fresh';
      return token;
    });

    server.use(
      http.get(`${BASE}/secure`, ({ request }) => {
        if (request.headers.get('authorization') !== 'Bearer fresh') {
          return HttpResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
        }
        return HttpResponse.json({ ok: true });
      }),
    );

    const [a, b] = await Promise.all([apiFetch('/secure'), apiFetch('/secure')]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(refreshCalls).toBe(1);
  });
});
