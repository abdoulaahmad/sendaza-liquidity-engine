import { PrismaOutboxRepository } from './prisma-outbox.repository';
import { PrismaService } from './prisma.service';

describe('PrismaOutboxRepository', () => {
  const create = jest.fn();
  const updateMany = jest.fn();
  const executeRaw = jest.fn();
  const queryRaw = jest.fn();
  const findFirst = jest.fn();
  const transaction = jest.fn(async (work: (tx: unknown) => unknown) =>
    work({
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      outboxEvent: { findFirst, updateMany },
    }),
  );
  const prisma = {
    outboxEvent: { create, updateMany },
    $transaction: transaction,
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  const repository = new PrismaOutboxRepository(prisma);

  beforeEach(() => {
    jest.resetAllMocks();
    transaction.mockImplementation(async (work: (tx: unknown) => unknown) =>
      work({
        $executeRaw: executeRaw,
        $queryRaw: queryRaw,
        outboxEvent: { findFirst, updateMany },
      }),
    );
  });

  it('enqueues a JSON event and returns its durable ID', async () => {
    create.mockResolvedValue({ id: 'event-1' });
    await expect(
      repository.enqueue({
        aggregateType: 'purchase',
        aggregateId: 'purchase-1',
        eventType: 'purchase.created',
        payload: { state: 'CREATED' },
        correlationId: '00000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toBe('event-1');
  });

  it('can enqueue through the caller financial transaction', async () => {
    const transactionCreate = jest.fn().mockResolvedValue({ id: 'event-transactional' });
    await expect(
      repository.enqueueInTransaction({ outboxEvent: { create: transactionCreate } } as never, {
        aggregateType: 'purchase',
        aggregateId: 'purchase-1',
        eventType: 'purchase.created',
        payload: { state: 'CREATED' },
        correlationId: '00000000-0000-4000-8000-000000000001',
      }),
    ).resolves.toBe('event-transactional');
    expect(transactionCreate).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('claims through one transaction and maps the payload', async () => {
    executeRaw.mockResolvedValue(0);
    queryRaw.mockResolvedValue([
      {
        id: 'event-1',
        aggregatetype: 'purchase',
        aggregateid: 'purchase-1',
        eventtype: 'purchase.created',
        payload: { state: 'CREATED' },
        correlationid: '00000000-0000-4000-8000-000000000001',
        occurredat: new Date('2026-08-31T11:59:00.000Z'),
        leasetoken: '00000000-0000-4000-8000-000000000002',
        leaseexpiresat: new Date(),
        attemptcount: 1,
        maxattempts: 10,
      },
    ]);
    const result = await repository.claimBatch({
      limit: 10,
      leaseSeconds: 30,
      now: new Date('2026-08-31T12:00:00.000Z'),
      leaseToken: '00000000-0000-4000-8000-000000000002',
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(result[0]?.payload).toEqual({ state: 'CREATED' });
    expect(result[0]?.aggregateId).toBe('purchase-1');
  });

  it('rejects invalid unbounded claims', async () => {
    await expect(
      repository.claimBatch({ limit: 101, leaseSeconds: 30, now: new Date(), leaseToken: 'token' }),
    ).rejects.toThrow('INVALID_OUTBOX_BATCH_LIMIT');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('requires ownership of the active lease to deliver', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.markDelivered('event-1', 'lease-1', new Date())).rejects.toThrow(
      'OUTBOX_LEASE_LOST',
    );
  });

  it.each([
    [1, 3, 'RETRY_SCHEDULED'],
    [3, 3, 'QUARANTINED'],
  ] as const)('maps attempt %s of %s to %s', async (attemptCount, maxAttempts, expected) => {
    findFirst.mockResolvedValue({ attemptCount, maxAttempts });
    updateMany.mockResolvedValue({ count: 1 });
    await expect(
      repository.markFailed(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        'DELIVERY_FAILED',
        new Date(),
        new Date(),
      ),
    ).resolves.toBe(expected);
  });
});
