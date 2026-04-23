/**
 * IPFS Module
 *
 * Provides secure IPFS file upload functionality.
 *
 * Features:
 * - Streaming file uploads
 * - Multiple IPFS provider support (Pinata, Web3.Storage, mock) with automatic failover
 * - Health checks and provider chain resilience
 * - Idempotency for duplicate prevention
 * - Rate limiting
 * - File validation and sanitization
 * - EXIF metadata stripping
 */
import { Module, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { IpfsController } from './ipfs.controller';
import { IpfsService } from './services/ipfs.service';
import { IdempotencyService } from './services/idempotency.service';
import { FileValidationService } from './services/file-validation.service';
import { IpfsProviderChainService } from './services/ipfs-provider-chain.service';
import { MockIpfsProvider } from './providers/mock-ipfs.provider';
import { PinataIpfsProvider } from './providers/pinata-ipfs.provider';
import { Web3StorageIpfsProvider } from './providers/web3storage-ipfs.provider';
import { IpfsProvider } from './interfaces/ipfs-provider.interface';

@Module({
  imports: [
    // Rate limiting configuration
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000, // 1 minute
        limit: 10, // 10 requests per minute
      },
      {
        name: 'medium',
        ttl: 3600000, // 1 hour
        limit: 100, // 100 requests per hour
      },
      {
        name: 'long',
        ttl: 86400000, // 1 day
        limit: 500, // 500 requests per day
      },
    ]),
  ],
  controllers: [IpfsController],
  providers: [
    // Services
    IpfsService,
    IdempotencyService,
    FileValidationService,
    IpfsProviderChainService,

    // Provider factory: builds ordered chain from comma-separated env var
    {
      provide: 'IPFS_PROVIDER_CHAIN',
      useFactory: (configService: ConfigService): IpfsProvider[] => {
        const providerList = configService.get<string>('IPFS_PROVIDERS', 'mock');
        const providerNames = providerList.split(',').map((s: string) => s.trim()).filter(Boolean);
        const providers: IpfsProvider[] = [];

        for (const name of providerNames) {
          switch (name) {
            case 'pinata':
              providers.push(new PinataIpfsProvider(configService));
              break;
            case 'web3storage':
              providers.push(new Web3StorageIpfsProvider(configService));
              break;
            case 'mock':
              providers.push(new MockIpfsProvider());
              break;
            default:
              Logger.warn(`Unknown IPFS provider "${name}" in IPFS_PROVIDERS; skipping`);
          }
        }

        if (providers.length === 0) {
          Logger.warn('No valid IPFS providers configured; falling back to mock');
          providers.push(new MockIpfsProvider());
        }

        return providers;
      },
      inject: [ConfigService],
    },
  ],
  exports: [IpfsService, IpfsProviderChainService],
})
export class IpfsModule implements OnModuleInit {
  private readonly logger = new Logger(IpfsModule.name);

  constructor(
    private readonly ipfsService: IpfsService,
    private readonly providerChain: IpfsProviderChainService,
    @Inject('IPFS_PROVIDER_CHAIN') private readonly providers: IpfsProvider[],
  ) {}

  onModuleInit() {
    this.providerChain.setProviders(this.providers);
    this.ipfsService.setProviderChain(this.providerChain);
    this.logger.log(
      `IPFS module initialized with ${this.providers.length} provider(s): ` +
      `${this.providers.map((p) => p.name).join(', ')}`,
    );
  }
}
