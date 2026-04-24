import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Response } from 'express';
import { RateLimitService } from './rate-limit.service';
import { RateLimitException } from './rate-limit.exception';
import { SorobanService } from '../rpc/soroban.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly rateLimitService: RateLimitService,
    private readonly soroban: SorobanService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse<Response>();
    const { policyId } = request.body;

    // If policyId is missing, let validation handle it
    if (!policyId) {
      return true;
    }

    try {
      // ── 1. Global circuit breaker ───────────────────────────────────────
      const globalCheck = await this.rateLimitService.checkGlobalLimit();
      if (!globalCheck.allowed) {
        response.setHeader('Retry-After', String(globalCheck.retryAfterSeconds));
        throw new RateLimitException({
          policyId: 'global',
          currentCount: globalCheck.retryAfterSeconds,
          limit: 0,
          windowResetLedger: 0,
          remainingLedgers: 0,
          retryAfterSeconds: globalCheck.retryAfterSeconds,
          limitType: 'global',
        });
      }

      // ── 2. Per-wallet sliding window ────────────────────────────────────
      const walletAddress = this.extractWalletAddress(request, policyId);
      if (walletAddress) {
        const walletCheck = await this.rateLimitService.checkWalletLimit(walletAddress);
        if (!walletCheck.allowed) {
          response.setHeader('Retry-After', String(walletCheck.retryAfterSeconds));
          throw new RateLimitException({
            policyId: walletAddress,
            currentCount: walletCheck.retryAfterSeconds,
            limit: 0,
            windowResetLedger: 0,
            remainingLedgers: 0,
            retryAfterSeconds: walletCheck.retryAfterSeconds,
            limitType: 'wallet',
          });
        }
      }

      // ── 3. Per-policy ledger-based limit ────────────────────────────────
      const currentLedger = await this.soroban.getLatestLedger();
      const result = await this.rateLimitService.checkAndIncrement(
        policyId,
        currentLedger,
      );

      if (!result.allowed) {
        const retryAfterLedgers = result.windowResetLedger - currentLedger;
        const retryAfterSeconds = Math.max(1, retryAfterLedgers * 5); // ~5s per ledger
        response.setHeader('Retry-After', String(retryAfterSeconds));
        throw new RateLimitException({
          policyId,
          currentCount: result.currentCount,
          limit: result.limit,
          windowResetLedger: result.windowResetLedger,
          remainingLedgers: retryAfterLedgers,
          retryAfterSeconds,
          limitType: 'policy',
        });
      }

      return true;
    } catch (error) {
      // Re-throw RateLimitException
      if (error instanceof RateLimitException) {
        throw error;
      }

      // Log other errors and fail open
      this.logger.error(`Rate limit check failed: ${error}`);
      return true;
    }
  }

  /**
   * Extract wallet address from request (JWT user, body, or policyId).
   */
  private extractWalletAddress(request: { user?: { walletAddress?: string }; body?: { holder?: string; policyId?: string } }, policyId?: string): string | undefined {
    // 1. Authenticated user
    if (request.user?.walletAddress) {
      return request.user.walletAddress;
    }

    // 2. Explicit holder field in body
    if (request.body?.holder) {
      return request.body.holder;
    }

    // 3. Parse from policyId (format: holderAddress:policyId)
    if (policyId && policyId.includes(':')) {
      const parts = policyId.split(':');
      // Stellar addresses start with G and are 56 chars
      const candidate = parts[0];
      if (candidate.length >= 56 && candidate.startsWith('G')) {
        return candidate;
      }
    }

    return undefined;
  }
}
