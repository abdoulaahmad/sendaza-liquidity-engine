import { MarketDataRefreshService } from './market-data';
import {
  ClaimedPricingRefreshJob,
  PricingRefreshBatchService,
  PricingRefreshJobRepository,
  pricingRefreshRetryAt,
} from './pricing-refresh';

const now = new Date('2026-09-01T12:00:00.000Z');
const job = (overrides: Partial<ClaimedPricingRefreshJob> = {}): ClaimedPricingRefreshJob => ({
  id: 'job-1',
  marketId: 'market-1',
  refreshIntervalSeconds: 15,
  attemptCount: 1,
  leaseToken: '00000000-0000-4000-8000-000000000001',
  leaseExpiresAt: new Date('2026-09-01T12:00:30.000Z'),
  ...overrides,
});

describe('PricingRefreshBatchService', () => {
  const claimBatch = jest.fn();
  const markCompleted = jest.fn();
  const markFailed = jest.fn();
  const jobs = { claimBatch, markCompleted, markFailed } as PricingRefreshJobRepository;
  const refreshMarket = jest.fn();
  const refresh = { refreshMarket } as unknown as MarketDataRefreshService;
  const service = new PricingRefreshBatchService(jobs, refresh, 5, 45);

  beforeEach(() => {
    jest.resetAllMocks();
    claimBatch.mockResolvedValue([job()]);
    markCompleted.mockResolvedValue(undefined);
    markFailed.mockResolvedValue(undefined);
  });

  it('completes an accepted market and schedules its configured interval', async () => {
    refreshMarket.mockResolvedValue({ evaluation: { status: 'ACCEPTED' } });
    await expect(service.processBatch(now, job().leaseToken)).resolves.toEqual({
      claimed: 1,
      refreshed: 1,
      rejected: 0,
      retryScheduled: 0,
    });
    expect(claimBatch).toHaveBeenCalledWith({
      limit: 5,
      leaseSeconds: 45,
      leaseToken: job().leaseToken,
      now,
    });
    expect(markCompleted).toHaveBeenCalledWith(
      'job-1',
      job().leaseToken,
      new Date('2026-09-01T12:00:15.000Z'),
    );
  });

  it('counts a safely persisted rejected snapshot as a completed refresh', async () => {
    refreshMarket.mockResolvedValue({ evaluation: { status: 'REJECTED' } });
    await expect(service.processBatch(now, job().leaseToken)).resolves.toMatchObject({
      rejected: 1,
      retryScheduled: 0,
    });
    expect(markCompleted).toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('retries an infrastructure failure with bounded backoff', async () => {
    claimBatch.mockResolvedValue([job({ attemptCount: 3 })]);
    refreshMarket.mockRejectedValue(new Error('database unavailable'));
    await expect(service.processBatch(now, job().leaseToken)).resolves.toMatchObject({
      refreshed: 0,
      rejected: 0,
      retryScheduled: 1,
    });
    expect(markFailed).toHaveBeenCalledWith(
      'job-1',
      job().leaseToken,
      'PRICING_REFRESH_FAILED',
      new Date('2026-09-01T12:00:20.000Z'),
    );
  });
});

describe('pricingRefreshRetryAt', () => {
  it.each([
    [1, '2026-09-01T12:00:05.000Z'],
    [3, '2026-09-01T12:00:20.000Z'],
    [20, '2026-09-01T12:05:00.000Z'],
  ])('calculates retry for attempt %s', (attempt, expected) => {
    expect(pricingRefreshRetryAt(now, attempt).toISOString()).toBe(expected);
  });
});
