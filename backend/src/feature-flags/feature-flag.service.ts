import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { FeatureFlag } from './feature-flag.entity';

export type FlagType = 'boolean' | 'percentage' | 'allowlist';

export interface FlagEvaluationContext {
  address?: string;
  userId?: string;
}

export interface EvaluatedFlag {
  key: string;
  enabled: boolean;
  type: FlagType;
  rollout?: number;
}

const CACHE_PREFIX = 'feature-flag:';
const CACHE_TTL_SECONDS = 300;

/**
 * Default flags seeded at boot when they are missing.
 */
const DEFAULT_FLAGS: Array<Partial<FeatureFlag> & { key: string }> = [
  { key: 'assets.enabled', type: 'boolean', enabled: true, rollout: 100 },
  { key: 'assets.admin-crud', type: 'boolean', enabled: true, rollout: 100 },
  { key: 'flags.percentage-rollout', type: 'percentage', enabled: true, rollout: 0 },
];

@Injectable()
export class FeatureFlagService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly redis: Redis;

  constructor(
    @InjectRepository(FeatureFlag)
    private readonly flagRepository: Repository<FeatureFlag>,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.redis.on('error', (err) =>
      this.logger.warn(`Redis unavailable for feature flags: ${err.message}`),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  /**
   * Seed default flags at boot when they are missing.
   */
  async seedDefaults(): Promise<void> {
    for (const def of DEFAULT_FLAGS) {
      const existing = await this.flagRepository.findOne({ where: { key: def.key } });
      if (!existing) {
        await this.flagRepository.save(this.flagRepository.create(def));
        this.logger.log(`Seeded default feature flag "${def.key}"`);
      }
    }
  }

  private cacheKey(key: string): string {
    return `${CACHE_PREFIX}${key}`;
  }

  private async readCache(key: string): Promise<FeatureFlag | null> {
    try {
      const raw = await this.redis.get(this.cacheKey(key));
      return raw ? (JSON.parse(raw) as FeatureFlag) : null;
    } catch {
      return null;
    }
  }

  private async writeCache(flag: FeatureFlag): Promise<void> {
    try {
      await this.redis.set(
        this.cacheKey(flag.key),
        JSON.stringify(flag),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch {
      // Cache is best-effort; DB remains the source of truth.
    }
  }

  /**
   * Invalidate the cached flag on update so the next read reflects the change.
   */
  async invalidateCache(key: string): Promise<void> {
    try {
      await this.redis.del(this.cacheKey(key));
    } catch {
      // ignore cache failures
    }
  }

  async getFlag(key: string): Promise<FeatureFlag | null> {
    const cached = await this.readCache(key);
    if (cached) {
      return cached;
    }
    const flag = await this.flagRepository.findOne({ where: { key } });
    if (flag) {
      await this.writeCache(flag);
    }
    return flag;
  }

  /**
   * Deterministic percentage rollout: the same address always maps to the
   * same bucket, so a rollout is stable across requests and instances.
   */
  private isInRollout(key: string, address: string, rollout: number): boolean {
    if (rollout <= 0) return false;
    if (rollout >= 100) return true;
    const hash = createHash('sha256').update(`${key}:${address}`).digest('hex');
    const bucket = parseInt(hash.slice(0, 8), 16) % 100;
    return bucket < rollout;
  }

  /**
   * Evaluate a single flag for the given caller context.
   */
  async evaluate(key: string, ctx: FlagEvaluationContext = {}): Promise<EvaluatedFlag> {
    const flag = await this.getFlag(key);
    if (!flag || !flag.enabled) {
      return { key, enabled: false, type: (flag?.type as FlagType) ?? 'boolean' };
    }

    const type = (flag.type as FlagType) ?? 'boolean';
    const identity = ctx.address ?? ctx.userId ?? '';

    switch (type) {
      case 'percentage':
        return {
          key,
          type,
          rollout: flag.rollout,
          enabled: identity ? this.isInRollout(key, identity, flag.rollout) : false,
        };
      case 'allowlist':
        return {
          key,
          type,
          enabled: !!identity && (flag.allowlist ?? []).includes(identity),
        };
      case 'boolean':
      default:
        return { key, type: 'boolean', enabled: true };
    }
  }

  /**
   * Evaluate all flags for the caller (used by GET /v1/flags).
   */
  async evaluateAll(ctx: FlagEvaluationContext = {}): Promise<EvaluatedFlag[]> {
    const flags = await this.flagRepository.find();
    return Promise.all(flags.map((flag) => this.evaluate(flag.key, ctx)));
  }

  async isEnabled(key: string, ctx: FlagEvaluationContext = {}): Promise<boolean> {
    const result = await this.evaluate(key, ctx);
    return result.enabled;
  }

  async list(): Promise<FeatureFlag[]> {
    return this.flagRepository.find();
  }

  async create(data: Partial<FeatureFlag>): Promise<FeatureFlag> {
    const flag = await this.flagRepository.save(this.flagRepository.create(data));
    await this.invalidateCache(flag.key);
    return flag;
  }

  async update(key: string, data: Partial<FeatureFlag>): Promise<FeatureFlag | null> {
    const flag = await this.getFlag(key);
    if (!flag) return null;
    Object.assign(flag, data);
    const saved = await this.flagRepository.save(flag);
    await this.invalidateCache(key);
    return saved;
  }

  async remove(key: string): Promise<void> {
    await this.flagRepository.delete({ key });
    await this.invalidateCache(key);
  }
}
