/**
 * IPFS Provider Chain Service
 *
 * Implements multi-gateway resilience for evidence uploads.
 *
 * Features:
 * - Configurable chain of IPFS providers tried in priority order
 * - Periodic health checks for each provider
 * - Automatic failover to next healthy provider on upload failure
 * - Observability: logs provider selection, fallback events, and health status
 */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IpfsProvider, IpfsUploadResult } from '../interfaces/ipfs-provider.interface';

export interface ProviderHealthRecord {
  provider: string;
  healthy: boolean;
  lastCheckedAt: Date;
  lastError?: string;
  consecutiveFailures: number;
}

export interface ProviderChainUploadResult extends IpfsUploadResult {
  /** Name of the provider that successfully handled the upload */
  providerName: string;
  /** Number of fallback attempts before success */
  fallbackCount: number;
}

@Injectable()
export class IpfsProviderChainService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IpfsProviderChainService.name);
  private providers: IpfsProvider[] = [];
  private healthRecords = new Map<string, ProviderHealthRecord>();
  private healthCheckIntervalMs: number;
  private healthCheckTimer?: NodeJS.Timeout;
  private maxConsecutiveFailures: number;

  constructor(private readonly configService: ConfigService) {
    this.healthCheckIntervalMs = this.configService.get<number>('IPFS_HEALTH_CHECK_INTERVAL_MS', 30000);
    this.maxConsecutiveFailures = this.configService.get<number>('IPFS_MAX_CONSECUTIVE_FAILURES', 3);
  }

  onModuleInit() {
    this.startHealthChecks();
  }

  onModuleDestroy() {
    this.stopHealthChecks();
  }

  /**
   * Register providers in priority order (lower index = higher priority).
   */
  setProviders(providers: IpfsProvider[]): void {
    this.providers = providers;
    // Initialize health records
    for (const provider of providers) {
      if (!this.healthRecords.has(provider.name)) {
        this.healthRecords.set(provider.name, {
          provider: provider.name,
          healthy: true,
          lastCheckedAt: new Date(),
          consecutiveFailures: 0,
        });
      }
    }
    this.logger.log(`Provider chain configured with ${providers.length} provider(s): ${providers.map((p) => p.name).join(', ')}`);
  }

  /**
   * Upload a file using the provider chain.
   * Tries each healthy provider in order until one succeeds.
   */
  async upload(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    options?: Record<string, unknown>,
  ): Promise<ProviderChainUploadResult> {
    const healthyProviders = this.getHealthyProviders();

    if (healthyProviders.length === 0) {
      this.logger.error('All IPFS providers are unhealthy. Upload cannot proceed.');
      throw new ServiceUnavailableException('All IPFS providers are currently unavailable');
    }

    let fallbackCount = 0;
    const lastErrorMessages: string[] = [];

    for (const provider of healthyProviders) {
      try {
        this.logger.debug(`Attempting upload via provider: ${provider.name} (fallbackCount=${fallbackCount})`);
        const result = await provider.upload(buffer, filename, mimeType, options);

        // Reset consecutive failures on success
        const record = this.healthRecords.get(provider.name);
        if (record) {
          record.consecutiveFailures = 0;
        }

        if (fallbackCount > 0) {
          this.logger.log(
            `IPFS fallback activated: primary provider failed, successfully uploaded via ${provider.name} ` +
            `after ${fallbackCount} fallback attempt(s)`,
          );
        } else {
          this.logger.log(`Successfully uploaded via primary provider: ${provider.name}`);
        }

        return {
          ...result,
          providerName: provider.name,
          fallbackCount,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        lastErrorMessages.push(`${provider.name}: ${message}`);
        this.logger.warn(`Provider ${provider.name} upload failed: ${message}`);

        // Increment consecutive failures
        const record = this.healthRecords.get(provider.name);
        if (record) {
          record.consecutiveFailures += 1;
          if (record.consecutiveFailures >= this.maxConsecutiveFailures) {
            record.healthy = false;
            record.lastError = message;
            this.logger.error(
              `Provider ${provider.name} marked unhealthy after ${record.consecutiveFailures} consecutive failures`,
            );
          }
        }

        fallbackCount += 1;
      }
    }

    // All providers failed
    this.logger.error(`All IPFS providers failed for upload. Errors: ${lastErrorMessages.join('; ')}`);
    throw new ServiceUnavailableException('Failed to upload to IPFS: all providers unavailable');
  }

  /**
   * Check if content exists on any healthy provider that supports exists().
   */
  async exists(cid: string): Promise<{ exists: boolean; providerName?: string }> {
    for (const provider of this.getHealthyProviders()) {
      if (provider.exists) {
        try {
          const found = await provider.exists(cid);
          if (found) {
            return { exists: true, providerName: provider.name };
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Provider ${provider.name} exists check failed for ${cid}: ${message}`);
        }
      }
    }
    return { exists: false };
  }

  /**
   * Unpin content from the first healthy provider that supports unpin().
   */
  async unpin(cid: string): Promise<{ success: boolean; providerName?: string }> {
    for (const provider of this.getHealthyProviders()) {
      if (provider.unpin) {
        try {
          const success = await provider.unpin(cid);
          if (success) {
            return { success: true, providerName: provider.name };
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Provider ${provider.name} unpin failed for ${cid}: ${message}`);
        }
      }
    }
    return { success: false };
  }

  /**
   * Get the currently healthy providers in priority order.
   */
  getHealthyProviders(): IpfsProvider[] {
    return this.providers.filter((provider) => {
      const record = this.healthRecords.get(provider.name);
      return record?.healthy ?? true;
    });
  }

  /**
   * Get health status for all registered providers.
   */
  getHealthStatus(): ProviderHealthRecord[] {
    return Array.from(this.healthRecords.values());
  }

  /**
   * Get the name of the current primary (first healthy) provider.
   */
  getPrimaryProviderName(): string {
    const healthy = this.getHealthyProviders();
    return healthy[0]?.name ?? 'none';
  }

  /**
   * Run a single health-check cycle across all providers.
   */
  async runHealthChecks(): Promise<void> {
    for (const provider of this.providers) {
      const record = this.healthRecords.get(provider.name);
      if (!record) continue;

      try {
        const healthy = await provider.isHealthy();
        const wasHealthy = record.healthy;
        record.healthy = healthy;
        record.lastCheckedAt = new Date();

        if (healthy) {
          if (!wasHealthy) {
            this.logger.log(`Provider ${provider.name} recovered and is now healthy`);
          }
          record.consecutiveFailures = 0;
          record.lastError = undefined;
        } else {
          record.lastError = 'Health check returned false';
          if (wasHealthy) {
            this.logger.warn(`Provider ${provider.name} health check failed — marked unhealthy`);
          }
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        record.healthy = false;
        record.lastCheckedAt = new Date();
        record.lastError = message;
        this.logger.warn(`Provider ${provider.name} health check threw: ${message}`);
      }
    }
  }

  private startHealthChecks(): void {
    if (this.healthCheckTimer) {
      return;
    }
    // Run initial check immediately
    this.runHealthChecks().catch((err) => this.logger.error('Initial health check failed', err));
    this.healthCheckTimer = setInterval(() => {
      this.runHealthChecks().catch((err) => this.logger.error('Periodic health check failed', err));
    }, this.healthCheckIntervalMs);
    this.logger.log(`IPFS provider health checks started (interval: ${this.healthCheckIntervalMs}ms)`);
  }

  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
      this.logger.log('IPFS provider health checks stopped');
    }
  }
}

