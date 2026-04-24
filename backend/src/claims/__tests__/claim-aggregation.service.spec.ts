/**
 * Claim Aggregation Service Tests
 *
 * Verifies quorum progress, votes_needed, and deadline_estimate_utc
 * calculations against fixed vote/voter fixtures.
 */
import { ClaimAggregationService } from '../services/claim-aggregation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../cache/redis.service';
import { ConfigService } from '@nestjs/config';

describe('ClaimAggregationService', () => {
  let service: ClaimAggregationService;
  let prismaMock: { claim: { findUnique: jest.Mock } };
  let redisMock: { get: jest.Mock; set: jest.Mock; del: jest.Mock; delPattern: jest.Mock };

  beforeEach(() => {
    prismaMock = {
      claim: {
        findUnique: jest.fn(),
      },
    };

    redisMock = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      delPattern: jest.fn().mockResolvedValue(undefined),
    };

    const configMock = {
      get: jest.fn((key: string, fallback: unknown) => fallback),
    };

    service = new ClaimAggregationService(
      prismaMock as unknown as PrismaService,
      redisMock as unknown as RedisService,
      configMock as unknown as ConfigService,
    );
  });

  describe('compute with eligibleVoterCount', () => {
    it('returns 0% progress when no votes cast', async () => {
      prismaMock.claim.findUnique.mockResolvedValue({
        createdAt: new Date(),
        createdAtLedger: 1_000_000,
        approveVotes: 0,
        rejectVotes: 0,
      });

      const result = await service.aggregate(1, 1_000_100, 10);
      expect(result.quorum_progress_pct).toBe(0);
      expect(result.votes_needed).toBe(6); // max(1, floor(10/2)+1) = 6
      expect(result.required_votes).toBe(6);
      expect(result.current_votes).toBe(0);
      expect(result.eligible_voter_source).toBe('contract_eligible_voters');
    });

    it('returns 50% progress when half quorum reached', async () => {
      prismaMock.claim.findUnique.mockResolvedValue({
        createdAt: new Date(),
        createdAtLedger: 1_000_000,
        approveVotes: 3,
        rejectVotes: 0,
      });

      const result = await service.aggregate(1, 1_000_100, 10);
      expect(result.quorum_progress_pct).toBe(50); // 3/6 = 50%
      expect(result.votes_needed).toBe(3);
      expect(result.required_votes).toBe(6);
      expect(result.current_votes).toBe(3);
    });

    it('returns 100% progress when quorum exceeded', async () => {
      prismaMock.claim.findUnique.mockResolvedValue({
        createdAt: new Date(),
        createdAtLedger: 1_000_000,
        approveVotes: 7,
        rejectVotes: 0,
      });

      const result = await service.aggregate(1, 1_000_100, 10);
      expect(result.quorum_progress_pct).toBe(100); // capped at 100
      expect(result.votes_needed).toBe(0);
    });

    it('calculates deadline from createdAtLedger', async () => {
      prismaMock.claim.findUnique.mockResolvedValue({
        createdAt: new Date('2024-01-01T00:00:00Z'),
        createdAtLedger: 1_000_000,
        approveVotes: 0,
        rejectVotes: 0,
      });

      const result = await service.aggregate(1, 1_000_100, 10);
      // deadlineLedger = 1_000_000 + 120_960 = 1_120_960
      // remainingLedgers = 1_120_960 - 1_000_100 = 120_860
      // remainingSeconds = 120_860 * 5 = 604_300
      expect(new Date(result.deadline_estimate_utc).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('compute without eligibleVoterCount (fallback)', () => {
    it('uses total votes as fallback eligible count', async () => {
      prismaMock.claim.findUnique.mockResolvedValue({
        createdAt: new Date(),
        createdAtLedger: 1_000_000,
        approveVotes: 5,
        rejectVotes: 3,
      });

      const result = await service.aggregate(1, 1_000_100);
      // totalVotes = 8, required = max(1, floor(8/2)+1) = 5
      expect(result.quorum_progress_pct).toBe(100); // 8/5 = 160% capped at 100
      expect(result.votes_needed).toBe(0);
      expect(result.eligible_voter_source).toBe('fallback_total_votes_cast');
    });

    it('handles zero votes with fallback', async () => {
      prismaMock.claim.findUnique.mockResolvedValue({
        createdAt: new Date(),
        createdAtLedger: 1_000_000,
        approveVotes: 0,
        rejectVotes: 0,
      });

      const result = await service.aggregate(1, 1_000_100);
      expect(result.quorum_progress_pct).toBe(0);
      expect(result.votes_needed).toBe(1); // max(1, floor(0/2)+1) = 1
      expect(result.eligible_voter_source).toBe('fallback_total_votes_cast');
    });
  });

  describe('caching', () => {
    it('returns cached value when available', async () => {
      const cached = {
        quorum_progress_pct: 42,
        votes_needed: 3,
        deadline_estimate_utc: new Date().toISOString(),
        required_votes: 5,
        current_votes: 2,
        eligible_voter_source: 'contract_eligible_voters',
      };
      redisMock.get.mockResolvedValue(cached);

      const result = await service.aggregate(1, 1_000_100, 10);
      expect(result).toEqual(cached);
      expect(prismaMock.claim.findUnique).not.toHaveBeenCalled();
    });

    it('caches computed result', async () => {
      prismaMock.claim.findUnique.mockResolvedValue({
        createdAt: new Date(),
        createdAtLedger: 1_000_000,
        approveVotes: 2,
        rejectVotes: 1,
      });

      await service.aggregate(1, 1_000_100, 10);
      expect(redisMock.set).toHaveBeenCalledWith(
        'claims:aggregate:1',
        expect.any(Object),
        30,
      );
    });

    it('invalidates cache for a claim', async () => {
      await service.invalidate(42);
      expect(redisMock.del).toHaveBeenCalledWith('claims:aggregate:42');
    });
  });

  describe('edge cases', () => {
    it('returns zero aggregation for non-existent claim', async () => {
      prismaMock.claim.findUnique.mockResolvedValue(null);

      const result = await service.aggregate(999, 1_000_100);
      expect(result.quorum_progress_pct).toBe(0);
      expect(result.votes_needed).toBe(1);
      expect(result.eligible_voter_source).toBe('unknown');
    });

    it('caps progress at 100% even with many votes', async () => {
      prismaMock.claim.findUnique.mockResolvedValue({
        createdAt: new Date(),
        createdAtLedger: 1_000_000,
        approveVotes: 100,
        rejectVotes: 50,
      });

      const result = await service.aggregate(1, 1_000_100, 10);
      expect(result.quorum_progress_pct).toBe(100);
    });

    it('uses odd eligible count correctly', async () => {
      prismaMock.claim.findUnique.mockResolvedValue({
        createdAt: new Date(),
        createdAtLedger: 1_000_000,
        approveVotes: 2,
        rejectVotes: 1,
      });

      const result = await service.aggregate(1, 1_000_100, 9);
      // required = max(1, floor(9/2)+1) = max(1, 4+1) = 5
      expect(result.required_votes).toBe(5);
      expect(result.quorum_progress_pct).toBe(60); // 3/5 = 60%
      expect(result.votes_needed).toBe(2);
    });
  });
});

