import { MarketDataRefreshService } from './market-data';

export interface ClaimedPricingRefreshJob {
  readonly id: string;
  readonly marketId: string;
  readonly refreshIntervalSeconds: number;
  readonly attemptCount: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
}

export interface PricingRefreshClaimOptions {
  readonly limit: number;
  readonly leaseSeconds: number;
  readonly leaseToken: string;
  readonly now: Date;
}

export abstract class PricingRefreshJobRepository {
  abstract claimBatch(
    options: PricingRefreshClaimOptions,
  ): Promise<readonly ClaimedPricingRefreshJob[]>;
  abstract markCompleted(
    jobId: string,
    leaseToken: string,
    nextRefreshAt: Date,
  ): Promise<void>;
  abstract markFailed(
    jobId: string,
    leaseToken: string,
    errorCode: string,
    nextRefreshAt: Date,
  ): Promise<void>;
}

export interface PricingRefreshBatchResult {
  readonly claimed: number;
  readonly refreshed: number;
  readonly rejected: number;
  readonly retryScheduled: number;
}

export class PricingRefreshBatchService {
  constructor(
    private readonly jobs: PricingRefreshJobRepository,
    private readonly refresh: MarketDataRefreshService,
    private readonly batchLimit = 10,
    private readonly leaseSeconds = 30,
  ) {}

  async processBatch(now: Date, leaseToken: string): Promise<PricingRefreshBatchResult> {
    const claimed = await this.jobs.claimBatch({
      limit: this.batchLimit,
      leaseSeconds: this.leaseSeconds,
      leaseToken,
      now,
    });
    let refreshed = 0;
    let rejected = 0;
    let retryScheduled = 0;
    for (const job of claimed) {
      try {
        const result = await this.refresh.refreshMarket(job.marketId);
        if (result.evaluation.status === 'ACCEPTED') refreshed += 1;
        else rejected += 1;
        await this.jobs.markCompleted(
          job.id,
          job.leaseToken,
          new Date(now.getTime() + job.refreshIntervalSeconds * 1000),
        );
      } catch {
        retryScheduled += 1;
        await this.jobs.markFailed(
          job.id,
          job.leaseToken,
          'PRICING_REFRESH_FAILED',
          pricingRefreshRetryAt(now, job.attemptCount),
        );
      }
    }
    return { claimed: claimed.length, refreshed, rejected, retryScheduled };
  }
}

export function pricingRefreshRetryAt(now: Date, attemptCount: number): Date {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new Error('INVALID_PRICING_REFRESH_ATTEMPT_COUNT');
  }
  const delaySeconds = Math.min(5 * 2 ** (attemptCount - 1), 300);
  return new Date(now.getTime() + delaySeconds * 1000);
}
