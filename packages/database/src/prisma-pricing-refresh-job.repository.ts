import { Injectable } from '@nestjs/common';
import {
  ClaimedPricingRefreshJob,
  PricingRefreshClaimOptions,
  PricingRefreshJobRepository,
} from '../../domain/src';
import { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma.service';

type ClaimedRow = {
  id: string;
  marketid: string;
  refreshintervalseconds: number;
  attemptcount: number;
  leasetoken: string;
  leaseexpiresat: Date;
};

@Injectable()
export class PrismaPricingRefreshJobRepository implements PricingRefreshJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimBatch(
    options: PricingRefreshClaimOptions,
  ): Promise<readonly ClaimedPricingRefreshJob[]> {
    validateClaim(options);
    const leaseExpiresAt = new Date(options.now.getTime() + options.leaseSeconds * 1000);
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT id
        FROM pricing_refresh_jobs
        WHERE (
          (status = 'PENDING' AND next_refresh_at <= ${options.now})
          OR (status = 'LEASED' AND lease_expires_at <= ${options.now})
        )
        ORDER BY next_refresh_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${options.limit}
      )
      UPDATE pricing_refresh_jobs AS job
      SET status = 'LEASED',
          lease_token = ${options.leaseToken}::uuid,
          lease_expires_at = ${leaseExpiresAt},
          attempt_count = job.attempt_count + 1,
          updated_at = ${options.now}
      FROM candidates
      WHERE job.id = candidates.id
      RETURNING job.id,
        job.market_id AS marketId,
        job.refresh_interval_seconds AS refreshIntervalSeconds,
        job.attempt_count AS attemptCount,
        job.lease_token AS leaseToken,
        job.lease_expires_at AS leaseExpiresAt
    `);
    return rows.map((row) => ({
      id: row.id,
      marketId: row.marketid,
      refreshIntervalSeconds: row.refreshintervalseconds,
      attemptCount: row.attemptcount,
      leaseToken: row.leasetoken,
      leaseExpiresAt: row.leaseexpiresat,
    }));
  }

  async markCompleted(jobId: string, leaseToken: string, nextRefreshAt: Date): Promise<void> {
    const result = await this.prisma.pricingRefreshJob.updateMany({
      where: { id: jobId, leaseToken, status: 'LEASED' },
      data: {
        status: 'PENDING',
        nextRefreshAt,
        leaseToken: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        lastErrorCode: null,
      },
    });
    if (result.count !== 1) throw new Error('PRICING_REFRESH_LEASE_LOST');
  }

  async markFailed(
    jobId: string,
    leaseToken: string,
    errorCode: string,
    nextRefreshAt: Date,
  ): Promise<void> {
    if (!/^[A-Z0-9_:-]{1,100}$/.test(errorCode)) {
      throw new Error('INVALID_PRICING_REFRESH_ERROR_CODE');
    }
    const result = await this.prisma.pricingRefreshJob.updateMany({
      where: { id: jobId, leaseToken, status: 'LEASED' },
      data: {
        status: 'PENDING',
        nextRefreshAt,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: errorCode,
      },
    });
    if (result.count !== 1) throw new Error('PRICING_REFRESH_LEASE_LOST');
  }
}

function validateClaim(options: PricingRefreshClaimOptions): void {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('INVALID_PRICING_REFRESH_BATCH_LIMIT');
  }
  if (
    !Number.isInteger(options.leaseSeconds) ||
    options.leaseSeconds < 1 ||
    options.leaseSeconds > 300
  ) {
    throw new Error('INVALID_PRICING_REFRESH_LEASE_SECONDS');
  }
}
