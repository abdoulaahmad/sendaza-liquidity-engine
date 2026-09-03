import { Injectable } from '@nestjs/common';
import { ClaimedNetworkFeeRefreshJob, NetworkFeeRefreshJobRepository } from '../../domain/src';
import { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma.service';

type ClaimRow = {
  id: string;
  policyid: string;
  refreshintervalseconds: number;
  attemptcount: number;
  leasetoken: string;
};

@Injectable()
export class PrismaNetworkFeeRefreshJobRepository implements NetworkFeeRefreshJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimBatch(input: {
    limit: number;
    leaseSeconds: number;
    leaseToken: string;
    now: Date;
  }): Promise<readonly ClaimedNetworkFeeRefreshJob[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error('INVALID_NETWORK_FEE_BATCH_LIMIT');
    }
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1000);
    const rows = await this.prisma.$queryRaw<ClaimRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT job.id FROM network_fee_refresh_jobs job
        JOIN network_fee_policy_versions policy ON policy.id = job.policy_id
        WHERE policy.status = 'ACTIVE' AND (
          (job.status = 'PENDING' AND job.next_refresh_at <= ${input.now})
          OR (job.status = 'LEASED' AND job.lease_expires_at <= ${input.now})
        ) ORDER BY job.next_refresh_at, job.created_at
        FOR UPDATE OF job SKIP LOCKED LIMIT ${input.limit}
      ) UPDATE network_fee_refresh_jobs AS job
      SET status='LEASED', lease_token=${input.leaseToken}::uuid,
          lease_expires_at=${leaseExpiresAt}, attempt_count=attempt_count+1,
          updated_at=${input.now}
      FROM candidates WHERE job.id=candidates.id
      RETURNING job.id, job.policy_id AS policyId,
        (SELECT refresh_interval_seconds FROM network_fee_policy_versions WHERE id=job.policy_id)
          AS refreshIntervalSeconds,
        job.attempt_count AS attemptCount, job.lease_token AS leaseToken
    `);
    return rows.map((row) => ({
      id: row.id,
      policyId: row.policyid,
      refreshIntervalSeconds: row.refreshintervalseconds,
      attemptCount: row.attemptcount,
      leaseToken: row.leasetoken,
    }));
  }

  async complete(jobId: string, leaseToken: string, nextRefreshAt: Date): Promise<void> {
    await this.release(jobId, leaseToken, nextRefreshAt, null, true);
  }

  async fail(
    jobId: string,
    leaseToken: string,
    errorCode: string,
    nextRefreshAt: Date,
  ): Promise<void> {
    if (!/^[A-Z0-9_:-]{1,100}$/.test(errorCode)) throw new Error('INVALID_FEE_ERROR_CODE');
    await this.release(jobId, leaseToken, nextRefreshAt, errorCode, false);
  }

  private async release(
    jobId: string,
    leaseToken: string,
    nextRefreshAt: Date,
    lastErrorCode: string | null,
    resetAttempts: boolean,
  ): Promise<void> {
    const result = await this.prisma.networkFeeRefreshJob.updateMany({
      where: { id: jobId, leaseToken, status: 'LEASED' },
      data: {
        status: 'PENDING',
        nextRefreshAt,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode,
        ...(resetAttempts ? { attemptCount: 0 } : {}),
      },
    });
    if (result.count !== 1) throw new Error('NETWORK_FEE_REFRESH_LEASE_LOST');
  }
}
