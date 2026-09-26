/**
 * Centralized query key factory.
 *
 * Keys are structured as `[feature, scope, ...params]` so that related queries
 * can be invalidated together (e.g. `queryClient.invalidateQueries({ queryKey: policyKeys.all })`).
 */

export type PolicyFilters = {
  status?: string;
  search?: string;
  page?: number;
};

export const policyKeys = {
  all: ['policies'] as const,
  lists: () => [...policyKeys.all, 'list'] as const,
  list: (filters: PolicyFilters = {}) => [...policyKeys.lists(), filters] as const,
  details: () => [...policyKeys.all, 'detail'] as const,
  detail: (id: string) => [...policyKeys.details(), id] as const,
};

export const claimKeys = {
  all: ['claims'] as const,
  lists: () => [...claimKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown> = {}) => [...claimKeys.lists(), filters] as const,
  details: () => [...claimKeys.all, 'detail'] as const,
  detail: (id: string) => [...claimKeys.details(), id] as const,
};
