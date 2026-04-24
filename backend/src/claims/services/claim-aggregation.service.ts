/**
 * Claim Aggregation Service
 *
 * Pre-computes quorum progress percentages and human-readable deadline estimates
 * for the claims board. Caches results in Redis with a short TTL and invalidates
 * when new votes are indexed.
 *
 * Quorum formula:
 *   required_votes = max(1, floor(eligible_voter_count * quorum_percentage))
 * In the current implementation eligible_voter_count is sourced from the total
 * number of votes cast plus abstentions observed on-chain. When the indexer
 * is enhanced to track eligible voters explicitly, this service should be updated
 * to use that authoritative source.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../cache/redis.service';

export interface ClaimAggregation {
  /** Quorum progress as a percentage (0–100) */
  quorum_progress_pct: number;
  /** Additional votes needed to reach quorum */
  votes_needed: number;
  /** Estimated UTC deadline when voting closes */
  deadline_estimate_utc: string;
  /** Number of votes required for quorum */
  required_votes: number;
  /** Current total votes cast */
  current_votes: number;
  /** Source of eligible voter count (for auditability) */
  eligible_voter_source: string;
}

const VOTE_WINDOW_LEDGERS = 120_960;
const SECONDS_PER_LEDGER = 5;
const CACHE_TTL_SECONDS = 30;

@Injectable()
export class ClaimAggregationService {
  private readonly logger = new Logger(ClaimAggregationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Compute (or fetch from cache) aggregated claim metrics.
   *
   * @param claimId - Database claim ID
   * @param lastLedger - Last processed ledger sequence (for deadline calc)
   * @param eligibleVoterCount - Number of eligible voters (from contract/indexer)
   */
  async aggregate(
    claimId: number,
    lastLedger: number,
    eligibleVoterCount?: number,
  ): Promise<ClaimAggregation> {
    const cacheKey = `claims:aggregate:${claimId}`;
    const cached = await this.redis.get<ClaimAggregation>(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.compute(claimId, lastLedger, eligibleVoterCount);
    await this.redis.set(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  }

  /**
   * Invalidate cached aggregation for a claim.
   * Call this from the vote indexer whenever a new vote row is inserted.
   */
  async invalidate(claimId: number): Promise<void> {
    await this.redis.del(`claims:aggregate:${claimId}`);
    this.logger.debug(`Aggregation cache invalidated for claim ${claimId}`);
  }

  /**
   * Invalidate all claim aggregations (use sparingly).
   */
  async invalidateAll(): Promise<void> {
    await this.redis.delPattern('claims:aggregate:*');
    this.logger.log('All aggregation caches invalidated');
  }

  private async compute(
    claimId: number,
    lastLedger: number,
    eligibleVoterCount?: number,
  ): Promise<ClaimAggregation> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: {
        createdAt: true,
        createdAtLedger: true,
        approveVotes: true,
        rejectVotes: true,
      },
    });

    if (!claim) {
      return this.zeroAggregation();
    }

    // ── Vote counts ───────────────────────────────────────────────────────
    const yesVotes = claim.approveVotes;
    const noVotes = claim.rejectVotes;
    const totalVotes = yesVotes + noVotes;

    // ── Eligible voter count ──────────────────────────────────────────────
    // Priority:
    //   1. Caller-provided value (from contract/indexer)
    //   2. Fallback: total votes cast (best effort when indexer lacks full eligible set)
    const effectiveEligibleVoters = eligibleVoterCount ?? totalVotes;
    const eligibleVoterSource = eligibleVoterCount != null
      ? 'contract_eligible_voters'
      : 'fallback_total_votes_cast';

    // ── Quorum formula (mirrors contract logic) ───────────────────────────
    // Required votes = max(1, floor(eligible_voters / 2) + 1)
    // This is a simple majority of eligible voters.
    const requiredVotes = Math.max(1, Math.floor(effectiveEligibleVoters / 2) + 1);

    // Progress percentage: how close are we to quorum?
    const quorumProgressPct = requiredVotes > 0
      ? Math.min(100, Math.round((totalVotes / requiredVotes) * 100))
      : 0;

    // Additional votes needed to reach quorum
    const votesNeeded = Math.max(0, requiredVotes - totalVotes);

    // ── Deadline estimate ─────────────────────────────────────────────────
    const deadlineLedger = claim.createdAtLedger + VOTE_WINDOW_LEDGERS;
    const remainingLedgers = Math.max(0, deadlineLedger - lastLedger);
    const remainingSeconds = remainingLedgers * SECONDS_PER_LEDGER;
    const deadlineEstimateUtc = new Date(Date.now() + remainingSeconds * 1000).toISOString();

    return {
      quorum_progress_pct: quorumProgressPct,
      votes_needed: votesNeeded,
      deadline_estimate_utc: deadlineEstimateUtc,
      required_votes: requiredVotes,
      current_votes: totalVotes,
      eligible_voter_source: eligibleVoterSource,
    };
  }

  private zeroAggregation(): ClaimAggregation {
    return {
      quorum_progress_pct: 0,
      votes_needed: 1,
      deadline_estimate_utc: new Date().toISOString(),
      required_votes: 1,
      current_votes: 0,
      eligible_voter_source: 'unknown',
    };
  }
}

