import { AsyncLocalStorage } from 'async_hooks';

/**
 * Identifier of the tenant a request is scoped to.
 *
 * The default tenant is used explicitly whenever a request does not resolve a
 * tenant (missing/unknown host or `X-Tenant-Id`). It is never interpreted as
 * "all tenants".
 */
export const DEFAULT_TENANT_ID = 'default';

export interface TenantContext {
  /** Resolved tenant id. Always set; falls back to {@link DEFAULT_TENANT_ID}. */
  tenantId: string;
  /** How the tenant was resolved for the current request. */
  source: 'host' | 'header' | 'default';
  /** Raw host / header value that produced the resolution, when applicable. */
  resolvedFrom?: string;
}

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `callback` with the given tenant bound to the async context.
 * Used by the tenant middleware so downstream Prisma access can read it.
 */
export function runWithTenant<T>(context: TenantContext, callback: () => T): T {
  return storage.run(context, callback);
}

/**
 * Current tenant context, or `undefined` when running outside a request
 * (background jobs, scripts, tests). Callers that need a tenant must use
 * {@link requireTenantId} or {@link getTenantId} so the default tenant is
 * applied explicitly instead of leaking across tenants.
 */
export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Tenant id for the current async context, falling back to the default tenant
 * explicitly. Never returns `undefined` and never means "all tenants".
 */
export function getTenantId(): string {
  return storage.getStore()?.tenantId ?? DEFAULT_TENANT_ID;
}

/**
 * Tenant id for the current async context, throwing when no tenant has been
 * resolved. Use this on tenant-scoped write paths where silently defaulting
 * would be unsafe.
 */
export function requireTenantId(): string {
  const context = storage.getStore();
  if (!context) {
    throw new Error(
      'No tenant context available. Ensure the tenant middleware ran for this request.',
    );
  }
  return context.tenantId;
}

/**
 * Resolve a tenant id from a request host or `X-Tenant-Id` header.
 *
 * Resolution order: explicit header, then host, then the default tenant.
 * Unknown values are treated as the default tenant rather than "all tenants".
 */
export function resolveTenantId(input: {
  host?: string | null;
  header?: string | null;
  knownTenantIds?: Iterable<string>;
}): TenantContext {
  const known = input.knownTenantIds ? new Set(input.knownTenantIds) : undefined;

  const header = normalize(input.header);
  if (header && (!known || known.has(header))) {
    return { tenantId: header, source: 'header', resolvedFrom: header };
  }

  const host = normalizeHost(input.host);
  if (host && (!known || known.has(host))) {
    return { tenantId: host, source: 'host', resolvedFrom: host };
  }

  return { tenantId: DEFAULT_TENANT_ID, source: 'default' };
}

function normalize(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeHost(host: string | null | undefined): string | undefined {
  const normalized = normalize(host)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  // Strip the port so `acme.example.com:3000` resolves to `acme.example.com`.
  return normalized.split(':')[0] || undefined;
}
