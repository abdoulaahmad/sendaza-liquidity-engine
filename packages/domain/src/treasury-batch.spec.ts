import {
  TreasuryRepository,
  TreasurySynchronizationService,
  TreasurySyncBatchService,
  TreasurySyncJobRepository,
} from './treasury';

describe('TreasurySyncBatchService', () => {
  const target = { walletId: 'wallet-1' } as never;
  const claimBatch = jest.fn();
  const complete = jest.fn();
  const fail = jest.fn();
  const jobs: TreasurySyncJobRepository = { claimBatch, complete, fail };
  const repository: TreasuryRepository = {
    listSyncTargets: jest.fn().mockResolvedValue([target]),
    saveSnapshot: jest.fn(),
  };
  const synchronize = jest.fn();
  const synchronization = { synchronize } as unknown as TreasurySynchronizationService;
  const service = new TreasurySyncBatchService(jobs, repository, synchronization, 10, 30, 60, 15);
  const now = new Date('2026-09-02T12:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    claimBatch.mockResolvedValue([{ jobId: 'job-1', walletId: 'wallet-1', leaseToken: 'lease-1' }]);
    complete.mockResolvedValue(undefined);
    fail.mockResolvedValue(undefined);
  });

  it('completes a successful claim with the normal refresh interval', async () => {
    synchronize.mockResolvedValue({});
    await expect(service.processBatch(now, 'lease-batch')).resolves.toEqual({
      claimed: 1,
      synchronized: 1,
      failed: 0,
    });
    expect(complete).toHaveBeenCalledWith('job-1', 'lease-1', new Date('2026-09-02T12:01:00.000Z'));
  });

  it('records a stable failure and schedules an earlier retry', async () => {
    synchronize.mockRejectedValue(new Error('CUSTODY_CREDENTIALS_INVALID'));
    await expect(service.processBatch(now, 'lease-batch')).resolves.toEqual({
      claimed: 1,
      synchronized: 0,
      failed: 1,
    });
    expect(fail).toHaveBeenCalledWith(
      'job-1',
      'lease-1',
      new Date('2026-09-02T12:00:15.000Z'),
      'CUSTODY_CREDENTIALS_INVALID',
    );
  });
});
