import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { Queue } from 'bullmq';
import { getBullMQConnection } from '../redis/client';
import { getQueueRetryConfig } from '../queues/queue-config';
import { ClaimSeverity, ClaimStatus, Prisma } from '@prisma/client';

export interface BackfillJobInfo {
  jobId: string;
  fromLedger: number;
  toLedger: number;
  batchSize: number;
}

export interface AdminStats {
  policies: number;
  activeCoverage: number;
  premiums: string;
  claimsByStatus: Record<string, number>;
  payouts: string;
}

export interface AnalyticsPoint {
  bucket: string;
  policies: number;
  claims: number;
  premiums: string;
  payouts: string;
}

export interface AdminAnalytics {
  range: string;
  series: AnalyticsPoint[];
  solvencyRatio: number;
}

const ANALYTICS_RANGES: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

const STATS_CACHE_TTL_MS = 30_000;

/**
 * Neutralise spreadsheet formula injection by prefixing cells that begin with
 * a formula trigger character with a single quote.
 */
export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** Serialise a single CSV row from an array of cell values. */
export function toCsvRow(cells: unknown[]): string {
  return cells.map(escapeCsvCell).join(',') + '\n';
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private reindexQueue: Queue;
  private backfillQueue: Queue;
  private statsCache: { value: AdminStats; expiresAt: number } | null = null;
  private analyticsCache = new Map<string, { value: AdminAnalytics; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {
    const reindexRetry = getQueueRetryConfig('reindex');
    const backfillRetry = getQueueRetryConfig('backfill');
    this.reindexQueue = new Queue('reindex', {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        attempts: reindexRetry.maxAttempts,
        backoff: reindexRetry.backoff,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
    this.backfillQueue = new Queue('backfill', {
      connection: getBullMQConnection(),
      defaultJobOptions: {
        attempts: backfillRetry.maxAttempts,
        backoff: backfillRetry.backoff,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 100 },
      },
    });
  }

  /**
   * Reset per-network cursor so the next indexer pass starts at `fromLedger`,
   * then enqueue a BullMQ job to drive catch-up (see ReindexWorkerService).
   */
  async enqueueReindex(fromLedger: number, network: string): Promise<string> {
    const lastProcessed = Math.max(0, fromLedger - 1);
    await this.prisma.$transaction(async (tx) => {
      await tx.ledgerCursor.upsert({
        where: { network },
        create: { network, lastProcessedLedger: lastProcessed },
        update: { lastProcessedLedger: lastProcessed },
      });
    });
    const job = await this.reindexQueue.add(
      'reindex',
      { fromLedger, network },
      { jobId: `reindex-${network}-${fromLedger}-${Date.now()}` },
    );
    const jobId = job.id!;

    this.logger.log(`Reindex job enqueued: ${jobId} network=${network} fromLedger=${fromLedger}`);
    return jobId;
  }

  /**
   * Split [fromLedger, toLedger] into batchSize-sized chunks and enqueue one
   * BullMQ backfill job per chunk. Returns the created job IDs and metadata.
   * Does NOT mutate the ledger cursor — backfill is a replay-only operation.
   */
  async enqueueBackfill(
    fromLedger: number,
    toLedger: number,
    network: string,
    batchSize: number,
  ): Promise<BackfillJobInfo[]> {
    const jobs: BackfillJobInfo[] = [];
    const ts = Date.now();
    let batchIndex = 0;

    for (let start = fromLedger; start <= toLedger; start += batchSize) {
      const end = Math.min(start + batchSize - 1, toLedger);
      const jobId = `backfill-${network}-${start}-${end}-${ts}-${batchIndex}`;
      const job = await this.backfillQueue.add(
        'backfill',
        { fromLedger: start, toLedger: end, network, batchSize },
        { jobId },
      );
      jobs.push({ jobId: job.id!, fromLedger: start, toLedger: end, batchSize });
      batchIndex++;
    }

    this.logger.log(
      `Backfill enqueued: ${jobs.length} job(s) for ${network} ledgers ${fromLedger}–${toLedger}`,
    );
    return jobs;
  }

  /** Retrieve BullMQ job status from the backfill queue. */
  async getBackfillJob(jobId: string): Promise<{
    jobId: string;
    state: string;
    data: unknown;
    progress: unknown;
    failedReason?: string;
    finishedOn?: number;
    processedOn?: number;
  } | null> {
    const job = await this.backfillQueue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    return {
      jobId: job.id!,
      state,
      data: job.data,
      progress: job.progress,
      failedReason: job.failedReason,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
    };
  }

  async searchClaims(options: {
    q?: string;
    status?: string;
    severity?: string;
    claimant?: string;
    policyId?: string;
    dateFrom?: string;
    dateTo?: string;
    after?: string;
    limit?: number;
  }) {
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Build where conditions
    const where: Prisma.ClaimWhereInput = {
      deletedAt: null, // Exclude soft-deleted
    };

    // Full-text search on description (case-insensitive contains)
    if (options.q) {
      where.description = {
        contains: options.q,
        mode: 'insensitive',
      };
    }

    // Status filter
    if (options.status) {
      where.status = options.status as ClaimStatus;
    }

    // Severity filter
    if (options.severity) {
      where.severity = options.severity.toUpperCase() as ClaimSeverity;
    }

    // Claimant (creator) filter
    if (options.claimant) {
      where.creatorAddress = options.claimant;
    }

    // Policy filter
    if (options.policyId) {
      where.policyId = options.policyId;
    }

    // Date range filters
    const dateConditions: Prisma.DateTimeFilter = {};
    if (options.dateFrom) {
      dateConditions.gte = new Date(options.dateFrom);
    }
    if (options.dateTo) {
      dateConditions.lte = new Date(options.dateTo);
    }
    if (Object.keys(dateConditions).length > 0) {
      where.createdAt = dateConditions;
    }

    // Keyset pagination: decode cursor
    let skipId: number | undefined;
    if (options.after) {
      try {
        const decoded = Buffer.from(options.after, 'base64').toString('utf-8');
        skipId = parseInt(decoded, 10);
        if (Number.isNaN(skipId)) skipId = undefined;
      } catch {
        skipId = undefined;
      }
    }

    // Fetch one extra record to determine if there's a next page
    const claims = await this.prisma.claim.findMany({
      where,
      orderBy: { createdAt: 'desc', id: 'desc' },
      take: limit + 1,
      skip: skipId ? 1 : 0,
      cursor: skipId ? { id: skipId } : undefined,
    });

    const hasNextPage = claims.length > limit;
    const data = claims.slice(0, limit);
    const nextCursor = hasNextPage ? Buffer.from(String(data[data.length - 1]?.id ?? '')).toString('base64') : null;

    // Get total count
    const total = await this.prisma.claim.count({ where });

    return {
      data,
      pagination: {
        total,
        nextCursor,
        hasNextPage,
      },
    };
  }

  /**
   * Aggregate dashboard totals. Heavy aggregates are cached briefly to avoid
   * hammering the database on every dashboard poll.
   */
  async getStats(): Promise<AdminStats> {
    const now = Date.now();
    if (this.statsCache && this.statsCache.expiresAt > now) {
      return this.statsCache.value;
    }

    const [policies, activeCoverage, premiumAgg, payoutAgg, claimsByStatusRaw] =
      await Promise.all([
        this.prisma.policy.count({ where: { deletedAt: null } }),
        this.prisma.policy.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
        this.prisma.policy.aggregate({
          where: { deletedAt: null },
          _sum: { premium: true },
        }),
        this.prisma.claim.aggregate({
          where: { deletedAt: null, status: 'PAID' },
          _sum: { payoutAmount: true },
        }),
        this.prisma.claim.groupBy({
          by: ['status'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
      ]);

    const claimsByStatus: Record<string, number> = {};
    for (const row of claimsByStatusRaw) {
      claimsByStatus[row.status] = row._count._all;
    }

    const value: AdminStats = {
      policies,
      activeCoverage,
      premiums: String(premiumAgg._sum.premium ?? '0'),
      claimsByStatus,
      payouts: String(payoutAgg._sum.payoutAmount ?? '0'),
    };

    this.statsCache = { value, expiresAt: now + STATS_CACHE_TTL_MS };
    return value;
  }

  /**
   * Time-series analytics over the requested range plus a solvency ratio
   * (premiums collected relative to payouts). Cached per range.
   */
  async getAnalytics(range = '30d'): Promise<AdminAnalytics> {
    const windowMs = ANALYTICS_RANGES[range] ?? ANALYTICS_RANGES['30d'];
    const now = Date.now();
    const cached = this.analyticsCache.get(range);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const since = new Date(now - windowMs);
    const bucketMs = Math.max(Math.floor(windowMs / 12), 60 * 60 * 1000);

    const [policies, claims] = await Promise.all([
      this.prisma.policy.findMany({
        where: { deletedAt: null, createdAt: { gte: since } },
        select: { createdAt: true, premium: true },
      }),
      this.prisma.claim.findMany({
        where: { deletedAt: null, createdAt: { gte: since } },
        select: { createdAt: true, payoutAmount: true, status: true },
      }),
    ]);

    const buckets = new Map<string, AnalyticsPoint>();
    const bucketKey = (d: Date) =>
      new Date(Math.floor(d.getTime() / bucketMs) * bucketMs).toISOString();

    const ensure = (key: string): AnalyticsPoint => {
      let point = buckets.get(key);
      if (!point) {
        point = { bucket: key, policies: 0, claims: 0, premiums: '0', payouts: '0' };
        buckets.set(key, point);
      }
      return point;
    };

    let totalPremiums = 0;
    let totalPayouts = 0;

    for (const policy of policies) {
      const point = ensure(bucketKey(policy.createdAt));
      point.policies += 1;
      const premium = Number(policy.premium ?? 0);
      point.premiums = String(Number(point.premiums) + premium);
      totalPremiums += premium;
    }

    for (const claim of claims) {
      const point = ensure(bucketKey(claim.createdAt));
      point.claims += 1;
      if (claim.status === 'PAID') {
        const payout = Number(claim.payoutAmount ?? 0);
        point.payouts = String(Number(point.payouts) + payout);
        totalPayouts += payout;
      }
    }

    const series = Array.from(buckets.values()).sort((a, b) =>
      a.bucket.localeCompare(b.bucket),
    );

    const solvencyRatio =
      totalPayouts > 0 ? Number((totalPremiums / totalPayouts).toFixed(4)) : totalPremiums > 0 ? Infinity : 0;

    const value: AdminAnalytics = { range, series, solvencyRatio };
    this.analyticsCache.set(range, { value, expiresAt: now + STATS_CACHE_TTL_MS });
    return value;
  }

  /**
   * Stream claims as CSV rows. Yields a header first, then one row per claim,
   * so the controller can pipe without buffering the whole result set.
   */
  async *streamClaimsCsv(): AsyncGenerator<string> {
    yield toCsvRow([
      'id',
      'policyId',
      'status',
      'severity',
      'creatorAddress',
      'payoutAmount',
      'createdAt',
    ]);

    const batchSize = 500;
    let cursor: number | undefined;

    for (;;) {
      const batch = await this.prisma.claim.findMany({
        where: { deletedAt: null },
        orderBy: { id: 'asc' },
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
      });
      if (batch.length === 0) break;

      for (const claim of batch) {
        yield toCsvRow([
          claim.id,
          claim.policyId,
          claim.status,
          claim.severity,
          claim.creatorAddress,
          claim.payoutAmount,
          claim.createdAt.toISOString(),
        ]);
      }

      cursor = batch[batch.length - 1].id;
      if (batch.length < batchSize) break;
    }
  }

  /** Stream policies as CSV rows (header first, then one row per policy). */
  async *streamPoliciesCsv(): AsyncGenerator<string> {
    yield toCsvRow([
      'id',
      'holderAddress',
      'status',
      'premium',
      'coverageAmount',
      'createdAt',
    ]);

    const batchSize = 500;
    let cursor: number | undefined;

    for (;;) {
      const batch = await this.prisma.policy.findMany({
        where: { deletedAt: null },
        orderBy: { id: 'asc' },
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
      });
      if (batch.length === 0) break;

      for (const policy of batch) {
        yield toCsvRow([
          policy.id,
          policy.holderAddress,
          policy.status,
          policy.premium,
          policy.coverageAmount,
          policy.createdAt.toISOString(),
        ]);
      }

      cursor = batch[batch.length - 1].id;
      if (batch.length < batchSize) break;
    }
  }

  /** List audit-log entries, newest first, with keyset pagination. */
  async getAuditLog(options: { after?: string; limit?: number } = {}) {
    const DEFAULT_LIMIT = 50;
    const MAX_LIMIT = 200;
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    let skipId: number | undefined;
    if (options.after) {
      try {
        const decoded = Buffer.from(options.after, 'base64').toString('utf-8');
        skipId = parseInt(decoded, 10);
        if (Number.isNaN(skipId)) skipId = undefined;
      } catch {
        skipId = undefined;
      }
    }

    const entries = await this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      skip: skipId ? 1 : 0,
      cursor: skipId ? { id: skipId } : undefined,
    });

    const hasNextPage = entries.length > limit;
    const data = entries.slice(0, limit);
    const nextCursor = hasNextPage
      ? Buffer.from(String(data[data.length - 1]?.id ?? '')).toString('base64')
      : null;

    return { data, pagination: { nextCursor, hasNextPage } };
  }

  /** Persist an admin action to the audit log. */
  async recordAudit(entry: {
    actor: string;
    action: string;
    target?: string;
    requestId?: string;
    outcome: string;
  }) {
    return this.prisma.adminAuditLog.create({
      data: {
        actor: entry.actor,
        action: entry.action,
        target: entry.target ?? null,
        requestId: entry.requestId ?? null,
        outcome: entry.outcome,
      },
    });
  }

  async setFeatureFlag(key: string, enabled: boolean, description: string | undefined, actor: string) {
    this.featureFlagsService.assertAllowlisted(key);
    const result = await this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, description, updatedBy: actor },
      update: { enabled, description, updatedBy: actor },
    });
    await this.featureFlagsService.refreshFlags();
    return result;
  }

  async createFeatureFlag(key: string, enabled: boolean, description: string | undefined, actor: string) {
    this.featureFlagsService.assertAllowlisted(key);
    const result = await this.prisma.featureFlag.create({
      data: { key, enabled, description: description ?? null, updatedBy: actor },
    });
    await this.featureFlagsService.refreshFlags();
    return result;
  }

  async getFeatureFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  /** Apply an array of {key, enabled} updates atomically in a single DB transaction.
   *  All keys are validated against the allowlist before the transaction begins. */
  async bulkSetFeatureFlags(
    updates: { key: string; enabled: boolean }[],
    actor: string,
  ): Promise<{ key: string; enabled: boolean }[]> {
    for (const { key } of updates) {
      this.featureFlagsService.assertAllowlisted(key);
    }
    return this.prisma.$transaction(
      updates.map(({ key, enabled }) =>
        this.prisma.featureFlag.upsert({
          where: { key },
          create: { key, enabled, updatedBy: actor },
          update: { enabled, updatedBy: actor },
        }),
      ),
    );
  }
}
