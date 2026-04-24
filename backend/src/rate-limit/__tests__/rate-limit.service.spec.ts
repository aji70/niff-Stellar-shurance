/**
 * Rate Limit Service Tests
 *
 * Tests per-wallet sliding window, global circuit breaker, and limit reset.
 */
import { RateLimitService } from '../rate-limit.service';
import { RedisService } from '../../cache/redis.service';
import { ConfigService } from '@nestjs/config';

describe('RateLimitService — wallet & global limits', () => {
  let service: RateLimitService;
  let redisMock: { getClient: jest.Mock; get: jest.Mock; set: jest.Mock };
  let redisClient: Record<string, jest.Mock>;

  beforeEach(() => {
    redisClient = {
      zremrangebyscore: jest.fn().mockResolvedValue(0),
      zcard: jest.fn().mockResolvedValue(0),
      zadd: jest.fn().mockResolvedValue(1),
      pexpire: jest.fn().mockResolvedValue(1),
      zrange: jest.fn().mockResolvedValue([]),
      hset: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      hget: jest.fn().mockResolvedValue(null),
      hincrby: jest.fn().mockResolvedValue(1),
      exists: jest.fn().mockResolvedValue(0),
    };

    redisMock = {
      getClient: jest.fn().mockReturnValue(redisClient),
      get: jest.fn(),
      set: jest.fn(),
    };

    const configMock = {
      get: jest.fn((key: string, fallback: unknown) => fallback),
    };

    service = new RateLimitService(redisMock as unknown as RedisService, configMock as unknown as ConfigService);
  });

  describe('checkWalletLimit', () => {
    it('allows request when under limit', async () => {
      redisClient.zcard.mockResolvedValue(0);
      const result = await service.checkWalletLimit('GABC123');
      expect(result.allowed).toBe(true);
      expect(result.retryAfterSeconds).toBe(0);
      expect(redisClient.zadd).toHaveBeenCalled();
    });

    it('blocks request when limit exceeded', async () => {
      redisClient.zcard.mockResolvedValue(3);
      redisClient.zrange.mockResolvedValue(['entry', String(Date.now() - 1800000)]); // 30 min ago
      const result = await service.checkWalletLimit('GABC123');
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('fails open on Redis error', async () => {
      redisClient.zcard.mockRejectedValue(new Error('Redis down'));
      const result = await service.checkWalletLimit('GABC123');
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkGlobalLimit', () => {
    it('allows request when under global limit', async () => {
      redisClient.zcard.mockResolvedValue(50);
      const result = await service.checkGlobalLimit();
      expect(result.allowed).toBe(true);
      expect(result.retryAfterSeconds).toBe(0);
    });

    it('blocks request when global circuit breaker triggered', async () => {
      redisClient.zcard.mockResolvedValue(100);
      redisClient.zrange.mockResolvedValue(['entry', String(Date.now() - 120000)]); // 2 min ago
      const result = await service.checkGlobalLimit();
      expect(result.allowed).toBe(false);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('fails open on Redis error', async () => {
      redisClient.zcard.mockRejectedValue(new Error('Redis down'));
      const result = await service.checkGlobalLimit();
      expect(result.allowed).toBe(true);
    });
  });
});

