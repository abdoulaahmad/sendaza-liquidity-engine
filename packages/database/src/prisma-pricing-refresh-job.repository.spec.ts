import { PrismaPricingRefreshJobRepository } from './prisma-pricing-refresh-job.repository';
import { PrismaService } from './prisma.service';

describe('PrismaPricingRefreshJobRepository', () => {
  const queryRaw = jest.fn();
  const updateMany = jest.fn();
  const prisma = {
    $queryRaw: queryRaw,
    pricingRefreshJob: { updateMany },
  } as unknown as PrismaService;
  const repository = new PrismaPricingRefreshJobRepository(prisma);
  const now = new Date('2026-09-01T12:00:00.000Z');
  const leaseToken = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => jest.resetAllMocks());

  it('claims a bounded leased batch and maps raw PostgreSQL aliases', async () => {
    queryRaw.mockResolvedValue([
      {
        id: 'job-1',
        marketid: 'market-1',
        refreshintervalseconds: 15,
        attemptcount: 2,
        leasetoken: leaseToken,
        leaseexpiresat: new Date('2026-09-01T12:00:30.000Z'),
      },
    ]);
    await expect(
      repository.claimBatch({ limit: 10, leaseSeconds: 30, leaseToken, now }),
    ).resolves.toEqual([
      {
        id: 'job-1',
        marketId: 'market-1',
        refreshIntervalSeconds: 15,
        attemptCount: 2,
        leaseToken,
        leaseExpiresAt: new Date('2026-09-01T12:00:30.000Z'),
      },
    ]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('releases a successful lease and resets retry state', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const next = new Date('2026-09-01T12:00:15.000Z');
    await repository.markCompleted('job-1', leaseToken, next);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', leaseToken, status: 'LEASED' },
      data: {
        status: 'PENDING',
        nextRefreshAt: next,
        leaseToken: null,
        leaseExpiresAt: null,
        attemptCount: 0,
        lastErrorCode: null,
      },
    });
  });

  it('records only a safe failure code and preserves attempts', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const next = new Date('2026-09-01T12:00:05.000Z');
    await repository.markFailed('job-1', leaseToken, 'PRICING_REFRESH_FAILED', next);
    expect(updateMany.mock.calls[0]?.[0].data).toEqual({
      status: 'PENDING',
      nextRefreshAt: next,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: 'PRICING_REFRESH_FAILED',
    });
    await expect(
      repository.markFailed('job-1', leaseToken, 'unsafe provider detail', next),
    ).rejects.toThrow('INVALID_PRICING_REFRESH_ERROR_CODE');
  });

  it('detects a lost lease instead of updating another worker claim', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.markCompleted('job-1', leaseToken, new Date('2026-09-01T12:00:15.000Z')),
    ).rejects.toThrow('PRICING_REFRESH_LEASE_LOST');
  });
});
