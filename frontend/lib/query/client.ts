import { QueryClient } from '@tanstack/react-query';

/**
 * Default options for the shared QueryClient.
 *
 * - `staleTime`: data is considered fresh for 60s, avoiding redundant refetches.
 * - `retry`: retries transient failures but never retries 4xx client errors.
 * - `refetchOnWindowFocus`: disabled globally; opt in per query when live data matters.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          const status = getErrorStatus(error);
          if (status !== undefined && status >= 400 && status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}

let browserQueryClient: QueryClient | undefined;

/**
 * Returns a QueryClient. On the server a new client is created per request so
 * that data never leaks between requests; in the browser a singleton is reused.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}
