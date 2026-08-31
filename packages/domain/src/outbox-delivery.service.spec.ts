import {
  ClaimedOutboxEvent,
  OutboxDeliveryService,
  OutboxPublisher,
  OutboxRepository,
} from './outbox';

describe('OutboxDeliveryService', () => {
  const event: ClaimedOutboxEvent = {
    id: 'event-1',
    aggregateType: 'purchase',
    aggregateId: 'purchase-1',
    eventType: 'purchase.created',
    payload: { state: 'CREATED' },
    correlationId: '00000000-0000-4000-8000-000000000001',
    attemptCount: 1,
    maxAttempts: 3,
    leaseToken: '00000000-0000-4000-8000-000000000002',
    leaseExpiresAt: new Date('2026-08-31T12:00:30.000Z'),
  };
  const claimBatch = jest.fn();
  const markDelivered = jest.fn();
  const markFailed = jest.fn();
  const repository = {
    claimBatch,
    markDelivered,
    markFailed,
    enqueue: jest.fn(),
  } as OutboxRepository;
  const publish = jest.fn();
  const publisher: OutboxPublisher = { publish };
  const service = new OutboxDeliveryService(repository, publisher);
  const now = new Date('2026-08-31T12:00:00.000Z');

  beforeEach(() => {
    jest.resetAllMocks();
    claimBatch.mockResolvedValue([event]);
    markDelivered.mockResolvedValue(undefined);
  });

  it('marks an event delivered only after publication succeeds', async () => {
    publish.mockResolvedValue(undefined);
    await expect(service.processBatch(now, event.leaseToken)).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      retryScheduled: 0,
      quarantined: 0,
    });
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(
      markDelivered.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('schedules retry with a safe provider error code', async () => {
    publish.mockRejectedValue({ code: 'SENDAZA_TIMEOUT', message: 'sensitive provider detail' });
    markFailed.mockResolvedValue('RETRY_SCHEDULED');
    await expect(service.processBatch(now, event.leaseToken)).resolves.toEqual({
      claimed: 1,
      delivered: 0,
      retryScheduled: 1,
      quarantined: 0,
    });
    expect(markFailed).toHaveBeenCalledWith(
      event.id,
      event.leaseToken,
      'SENDAZA_TIMEOUT',
      new Date('2026-08-31T12:00:05.000Z'),
      now,
    );
    expect(JSON.stringify(markFailed.mock.calls)).not.toContain('sensitive');
  });

  it('counts exhausted delivery as quarantined', async () => {
    publish.mockRejectedValue(new Error('do not persist this message'));
    markFailed.mockResolvedValue('QUARANTINED');
    await expect(service.processBatch(now, event.leaseToken)).resolves.toEqual({
      claimed: 1,
      delivered: 0,
      retryScheduled: 0,
      quarantined: 1,
    });
    expect(markFailed).toHaveBeenCalledWith(
      event.id,
      event.leaseToken,
      'DELIVERY_FAILED',
      expect.any(Date),
      now,
    );
  });
});
