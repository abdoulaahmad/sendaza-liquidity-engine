import { SendazaWebhookConfiguration } from '../../../packages/configuration/src';
import { OutboxDeliveryService } from '../../../packages/domain/src';
import { OutboxWorker } from './outbox.worker';

describe('OutboxWorker', () => {
  const empty = { claimed: 0, delivered: 0, retryScheduled: 0, quarantined: 0 };

  afterEach(() => jest.useRealTimers());

  it('uses a fresh UUID lease token for a manual batch', async () => {
    const processBatch = jest.fn().mockResolvedValue(empty);
    const worker = new OutboxWorker(
      { processBatch } as unknown as OutboxDeliveryService,
      { pollIntervalMs: 1000 } as SendazaWebhookConfiguration,
    );
    await worker.processOnce();
    expect(processBatch).toHaveBeenCalledWith(
      expect.any(Date),
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });

  it('never overlaps scheduled batches and waits during shutdown', async () => {
    jest.useFakeTimers();
    let resolveFirst: ((value: typeof empty) => void) | undefined;
    const first = new Promise<typeof empty>((resolve) => {
      resolveFirst = resolve;
    });
    const processBatch = jest.fn().mockReturnValueOnce(first).mockResolvedValue(empty);
    const worker = new OutboxWorker(
      { processBatch } as unknown as OutboxDeliveryService,
      { pollIntervalMs: 1000 } as SendazaWebhookConfiguration,
    );
    worker.onModuleInit();
    jest.advanceTimersByTime(0);
    await Promise.resolve();
    expect(processBatch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    expect(processBatch).toHaveBeenCalledTimes(1);
    const shutdown = worker.onModuleDestroy();
    let completed = false;
    void shutdown.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    resolveFirst?.(empty);
    await shutdown;
    expect(completed).toBe(true);
    jest.advanceTimersByTime(5000);
    expect(processBatch).toHaveBeenCalledTimes(1);
  });
});
