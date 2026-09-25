import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { TenantService } from './tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantContextService } from './tenant-context.service';

@Controller('v1/tenant')
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Public branding/config endpoint. Resolves the tenant from the request
   * (host or X-Tenant-Id) via the tenant middleware and returns only the
   * public branding information for that tenant. Falls back to the default
   * tenant explicitly when no tenant is resolved.
   */
  @Get('config')
  async getConfig(@Req() req: Request) {
    const tenantId =
      this.tenantContext.getTenantId() ??
      (req as Request & { tenantId?: string }).tenantId ??
      this.tenantService.getDefaultTenantId();

    return this.tenantService.getPublicConfig(tenantId);
  }

  /**
   * Admin onboarding: creates a tenant together with its config
   * (branding, allowed assets, feature flags) and writes a
   * TenantConfigAuditLog entry for the creation.
   */
  @Post('onboard')
  @UseGuards(AdminGuard)
  async onboard(@Body() dto: CreateTenantDto, @Req() req: Request) {
    const actorId =
      (req as Request & { user?: { id?: string } }).user?.id ?? 'system';

    return this.tenantService.onboardTenant(dto, actorId);
  }
}
