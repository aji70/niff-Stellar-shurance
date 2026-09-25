import { AsyncLocalStorage } from 'async_hooks';
import { Prisma } from '@prisma/client';

/**
 * Models that are scoped to a single tenant. Every query against these models
 * must be filtered by the resolved tenant id so that tenants can never read or
 * write each other's data.
 */
export const TENANT_SCOPED_MODELS = new Set<string>([
  'User',
  'Asset',
  'Project',
  'TenantConfig',
  'TenantConfigAuditLog',
]);

/**
 * The tenant that is used when a request does not resolve a tenant. It is an
 * explicit, real tenant id — never a wildcard / "all tenants" value.
 */
export const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID ?? 'default';

export interface TenantContext {
  tenantId: string;
  /**
   * When true the tenant filter is skipped. This is only ever set by trusted
   * internal code paths (e.g. tenant onboarding / migrations), never by an
   * incoming request.
   */
  bypass?: boolean;
}

/**
 * Request-scoped tenant context. Middleware runs `tenantContext.run(...)` so
 * that every Prisma call made while handling the request can read the tenant
 * without threading it through every function signature.
 */
export const tenantContext = new AsyncLocalStorage<TenantContext>();

/**
 * Resolve the current tenant id. Falls back to the default tenant explicitly
 * so that a request without a tenant is scoped to the default tenant rather
 * than to "all tenants".
 */
export function getTenantId(): string {
  return tenantContext.getStore()?.tenantId ?? DEFAULT_TENANT_ID;
}

/**
 * Run `fn` with an explicit tenant context. Used by middleware and by trusted
 * internal flows (onboarding) that need to operate on a specific tenant.
 */
export function runWithTenant<T>(
  tenantId: string,
  fn: () => T,
  options: { bypass?: boolean } = {},
): T {
  return tenantContext.run(
    { tenantId: tenantId || DEFAULT_TENANT_ID, bypass: options.bypass },
    fn,
  );
}

function isTenantScoped(model: string | undefined): boolean {
  return !!model && TENANT_SCOPED_MODELS.has(model);
}

function withTenantFilter(
  where: Record<string, unknown> | undefined,
  tenantId: string,
): Record<string, unknown> {
  return { ...(where ?? {}), tenantId };
}

/**
 * Prisma client extension that injects `tenantId` filters into every query on
 * tenant-scoped models. Reads are filtered, writes are stamped, and cross-tenant
 * updates/deletes are prevented by scoping the `where` clause.
 */
export const tenantExtension = Prisma.defineExtension((client) =>
  client.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const store = tenantContext.getStore();
          if (!isTenantScoped(model) || store?.bypass) {
            return query(args);
          }

          const tenantId = store?.tenantId ?? DEFAULT_TENANT_ID;
          const nextArgs = { ...(args as Record<string, unknown>) };

          switch (operation) {
            case 'findUnique':
            case 'findUniqueOrThrow':
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'findMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
              nextArgs.where = withTenantFilter(
                nextArgs.where as Record<string, unknown> | undefined,
                tenantId,
              );
              break;
            case 'update':
            case 'updateMany':
            case 'delete':
            case 'deleteMany':
              nextArgs.where = withTenantFilter(
                nextArgs.where as Record<string, unknown> | undefined,
                tenantId,
              );
              break;
            case 'create':
              nextArgs.data = {
                ...(nextArgs.data as Record<string, unknown>),
                tenantId,
              };
              break;
            case 'createMany':
              nextArgs.data = Array.isArray(nextArgs.data)
                ? (nextArgs.data as Record<string, unknown>[]).map((row) => ({
                    ...row,
                    tenantId,
                  }))
                : { ...(nextArgs.data as Record<string, unknown>), tenantId };
              break;
            case 'upsert':
              nextArgs.where = withTenantFilter(
                nextArgs.where as Record<string, unknown> | undefined,
                tenantId,
              );
              nextArgs.create = {
                ...(nextArgs.create as Record<string, unknown>),
                tenantId,
              };
              nextArgs.update = {
                ...(nextArgs.update as Record<string, unknown>),
                tenantId,
              };
              break;
            default:
              break;
          }

          return query(nextArgs);
        },
      },
    },
  }),
);

export default tenantExtension;
