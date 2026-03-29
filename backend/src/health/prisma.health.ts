import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

/** Timeout for the DB health probe — short enough to not hold a connection open. */
const DB_HEALTH_TIMEOUT_MS = 2_000;

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prismaService: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await Promise.race([
        this.prismaService.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`DB health check timed out after ${DB_HEALTH_TIMEOUT_MS}ms`)),
            DB_HEALTH_TIMEOUT_MS,
          ),
        ),
      ]);
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'Prisma check failed',
        this.getStatus(key, false, {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
    }
  }
}
