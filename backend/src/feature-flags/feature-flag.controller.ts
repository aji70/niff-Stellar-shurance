import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureFlag, FeatureFlagType } from './feature-flag.entity';
import { Feature } from './feature.decorator';
import { FeatureGuard } from './feature.guard';
import { AdminGuard } from '../admin/admin.guard';

interface CreateFlagDto {
  key: string;
  type: FeatureFlagType;
  enabled?: boolean;
  percentage?: number;
  allowlist?: string[];
  description?: string;
}

interface UpdateFlagDto {
  enabled?: boolean;
  percentage?: number;
  allowlist?: string[];
  description?: string;
}

@Controller('v1/flags')
export class FeatureFlagController {
  constructor(private readonly featureFlagService: FeatureFlagService) {}

  /**
   * Public endpoint returning flags evaluated for the caller.
   * Percentage rollouts are deterministic per caller address.
   */
  @Get()
  async getFlags(@Req() req: Request): Promise<Record<string, boolean>> {
    const address = this.resolveAddress(req);
    return this.featureFlagService.evaluateAll(address);
  }

  @Get('admin')
  @UseGuards(AdminGuard)
  async list(): Promise<FeatureFlag[]> {
    return this.featureFlagService.findAll();
  }

  @Post('admin')
  @UseGuards(AdminGuard)
  async create(@Body() dto: CreateFlagDto): Promise<FeatureFlag> {
    return this.featureFlagService.create(dto);
  }

  @Patch('admin/:key')
  @UseGuards(AdminGuard)
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateFlagDto,
  ): Promise<FeatureFlag> {
    return this.featureFlagService.update(key, dto);
  }

  @Delete('admin/:key')
  @UseGuards(AdminGuard)
  async remove(@Param('key') key: string): Promise<{ deleted: boolean }> {
    await this.featureFlagService.remove(key);
    return { deleted: true };
  }

  /**
   * Example guarded route demonstrating the @Feature decorator.
   * Kept minimal; real feature routes live in their own modules.
   */
  @Get('check/:key')
  @UseGuards(FeatureGuard)
  @Feature('beta-dashboard')
  async check(@Query('key') key: string): Promise<{ key: string; enabled: boolean }> {
    return { key, enabled: true };
  }

  private resolveAddress(req: Request): string | undefined {
    const header = req.headers['x-wallet-address'];
    if (typeof header === 'string' && header.length > 0) {
      return header;
    }
    const user = (req as Request & { user?: { address?: string } }).user;
    return user?.address;
  }
}
