import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Asset } from './asset.entity';
import { ContractAllowlistService } from '../contracts/contract-allowlist.service';
import { RedisCacheService } from '../cache/redis-cache.service';

const ASSETS_CACHE_KEY = 'assets:allowed';
const ASSETS_CACHE_TTL_SECONDS = 300;

export interface AssetMismatch {
  assetId: string;
  code: string;
  issuer: string;
  reason: string;
}

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);

  constructor(
    @InjectRepository(Asset)
    private readonly assetRepository: Repository<Asset>,
    private readonly contractAllowlistService: ContractAllowlistService,
    private readonly cache: RedisCacheService,
  ) {}

  /**
   * Public, cached list of allowed assets for the frontend.
   */
  async getPublicAssets(): Promise<Asset[]> {
    const cached = await this.cache.get<Asset[]>(ASSETS_CACHE_KEY);
    if (cached) {
      return cached;
    }

    const assets = await this.assetRepository.find({
      where: { enabled: true },
      order: { code: 'ASC' },
    });

    await this.cache.set(ASSETS_CACHE_KEY, assets, ASSETS_CACHE_TTL_SECONDS);
    return assets;
  }

  async listAssets(): Promise<Asset[]> {
    return this.assetRepository.find({ order: { code: 'ASC' } });
  }

  async createAsset(input: Partial<Asset>): Promise<Asset> {
    const existing = await this.assetRepository.findOne({
      where: { code: input.code, issuer: input.issuer },
    });
    if (existing) {
      throw new ConflictException('Asset already exists');
    }

    const asset = this.assetRepository.create(input);
    const saved = await this.assetRepository.save(asset);
    await this.invalidateCache();
    return saved;
  }

  async updateAsset(id: string, input: Partial<Asset>): Promise<Asset> {
    const asset = await this.assetRepository.findOne({ where: { id } });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    Object.assign(asset, input);
    const saved = await this.assetRepository.save(asset);
    await this.invalidateCache();
    return saved;
  }

  async deleteAsset(id: string): Promise<void> {
    const asset = await this.assetRepository.findOne({ where: { id } });
    if (!asset) {
      throw new NotFoundException('Asset not found');
    }

    await this.assetRepository.remove(asset);
    await this.invalidateCache();
  }

  /**
   * Cross-check configured assets against the contract allowlist so the admin
   * UI can flag mismatches (asset configured but not allowed on-chain, or
   * allowed on-chain but missing/disabled in config).
   */
  async detectMismatches(): Promise<AssetMismatch[]> {
    const [assets, allowlist] = await Promise.all([
      this.assetRepository.find(),
      this.contractAllowlistService.getAllowlist(),
    ]);

    const allowedKeys = new Set(
      allowlist.map((entry) => `${entry.code}:${entry.issuer}`),
    );
    const configuredKeys = new Set(
      assets.map((asset) => `${asset.code}:${asset.issuer}`),
    );

    const mismatches: AssetMismatch[] = [];

    for (const asset of assets) {
      const key = `${asset.code}:${asset.issuer}`;
      if (!allowedKeys.has(key)) {
        mismatches.push({
          assetId: asset.id,
          code: asset.code,
          issuer: asset.issuer,
          reason: 'Asset is configured but not present in the contract allowlist',
        });
      } else if (!asset.enabled) {
        mismatches.push({
          assetId: asset.id,
          code: asset.code,
          issuer: asset.issuer,
          reason: 'Asset is allowed on-chain but disabled in configuration',
        });
      }
    }

    for (const entry of allowlist) {
      const key = `${entry.code}:${entry.issuer}`;
      if (!configuredKeys.has(key)) {
        mismatches.push({
          assetId: '',
          code: entry.code,
          issuer: entry.issuer,
          reason: 'Asset is allowed on-chain but missing from configuration',
        });
      }
    }

    return mismatches;
  }

  private async invalidateCache(): Promise<void> {
    await this.cache.del(ASSETS_CACHE_KEY);
  }
}
