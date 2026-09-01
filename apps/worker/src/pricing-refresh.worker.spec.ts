import { PricingRefreshConfiguration } from '../../../packages/configuration/src';
import { PricingRefreshBatchService } from '../../../packages/domain/src';
import { PricingRefreshWorker } from './pricing-refresh.worker';

describe('PricingRefreshWorker', () => {
  const empty = { claimed: 0, refreshed: 0, rejected: 0, retryScheduled: 0 };

  afterEach(() => jest.useRealTimers());

  it('uses a fresh lease token for a manual batch', async () => {
    const processBatch = jest.fn().mockResolvedValue(empty);
    const worker = new PricingRefreshWorker(
      { processBatch } as unknown as PricingRefreshBatchService,
      { pollIntervalMs: 1000 } as PricingRefreshConfiguration,
    );
    await worker.processOnce();
    expect(processBatch).toHaveBeenCalledWith(
      expect.any(Date),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });

  it('does not overlap pricing batches and waits during shutdown', async () => {
    jest.useFakeTimers();
    let resolveFirst: ((value: typeof empty) => void) | undefined;
    const first = new Promise<typeof empty>((resolve) => {
      resolveFirst = resolve;
    });
    const processBatch = jest.fn().mockReturnValueOnce(first).mockResolvedValue(empty);
    const worker = new PricingRefreshWorker(
      { processBatch } as unknown as PricingRefreshBatchService,
      { pollIntervalMs: 1000 } as PricingRefreshConfiguration,
    );
    worker.onModuleInit();
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    expect(processBatch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    expect(processBatch).toHaveBeenCalledTimes(1);
    const shutdown = worker.onModuleDestroy();
    resolveFirst?.(empty);
    await shutdown;
    jest.advanceTimersByTime(5000);
    expect(processBatch).toHaveBeenCalledTimes(1);
  });
});
