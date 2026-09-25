import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import { TenantContextService } from './tenant-context.service';

/**
 * TenantMiddleware
 *
 * Resolves the tenant for each request and stores it in the REQUEST-scoped
 * TenantContextService. Resolution order:
 *
 *   1. `x-tenant-id` header  (explicit — used by API integrations)
 *   2. Subdomain of the Host header: `<tenantId>.niffyinsur.com`
 *
 * When TENANT_RESOLUTION_ENABLED is not "true" (default), resolution is
 * skipped entirely and tenantId stays null — single-tenant mode.
 *
 * Tenant IDs are validated against a simple allowlist pattern:
 *   - 3–64 characters
 *   - lowercase alphanumeric + hyphens only
 *   - must not start or end with a hyphen
 * Invalid values are silently ignored (tenantId stays null).
 *
 * When no tenant can be resolved, the request is explicitly bound to the
 * configured default tenant (DEFAULT_TENANT_ID) so that downstream data
 * access is always scoped to a single tenant — never "all tenants".
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);
  private readonly enabled: boolean;
  private readonly baseDomain: string;
  private readonly defaultTenantId: string;

  constructor(
    private readonly tenantCtx: TenantContextService,
    private readonly config: ConfigService,
  ) {
    this.enabled = this.config.get<boolean>('TENANT_RESOLUTION_ENABLED', false);
    this.baseDomain = this.config.get<string>('TENANT_BASE_DOMAIN', 'niffyinsur.com');
    this.defaultTenantId = this.config.get<string>('DEFAULT_TENANT_ID', 'default');
  }

  use(req: Request & { tenantId?: string | null }, _res: Response, next: NextFunction): void {
    if (!this.enabled) {
      req.tenantId = this.defaultTenantId;
      this.tenantCtx.tenantId = this.defaultTenantId;
      return next();
    }

    const resolved = this.resolveFromHeader(req) ?? this.resolveFromSubdomain(req);
    const tenantId = resolved ?? this.defaultTenantId;
    req.tenantId = tenantId;

    this.tenantCtx.tenantId = tenantId;
    if (resolved) {
      this.logger.debug(`Resolved tenant: ${tenantId}`);
    } else {
      this.logger.debug(`No tenant resolved, using default tenant: ${tenantId}`);
    }

    next();
  }

  private resolveFromHeader(req: Request): string | null {
    const raw = req.headers['x-tenant-id'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value ? this.validate(value.trim()) : null;
  }

  private resolveFromSubdomain(req: Request): string | null {
    const host = (req.headers['host'] ?? '').split(':')[0]; // strip port
    if (!host.endsWith(`.${this.baseDomain}`)) return null;
    const subdomain = host.slice(0, host.length - this.baseDomain.length - 1);
    return subdomain ? this.validate(subdomain) : null;
  }

  /** Returns the value if valid, null otherwise. */
  private validate(value: string): string | null {
    const TENANT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$|^[a-z0-9]{3}$/;
    return TENANT_ID_RE.test(value) ? value : null;
  }
}
