import { IdempotencyIdentity } from '../../domain/src';
import { PrismaIdempotencyRepository } from './prisma-idempotency.repository';
import { PrismaService } from './prisma.service';

describe('PrismaIdempotencyRepository', () => {
  const create = jest.fn();
  const findUniqueOrThrow = jest.fn();
  const updateMany = jest.fn();
  const prisma = {
    idempotencyRecord: { create, findUniqueOrThrow, updateMany },
  } as unknown as PrismaService;
  const repository = new PrismaIdempotencyRepository(prisma);
  const identity: IdempotencyIdentity = {
    clientId: 'sendaza-core',
    operation: 'purchases.create',
    key: 'purchase-1',
    requestHash: 'a'.repeat(64),
    correlationId: '00000000-0000-4000-8000-000000000001',
  };

  beforeEach(() => jest.resetAllMocks());

  it('acquires the first request', async () => {
    create.mockResolvedValue({ id: 'record-1' });
    await expect(repository.acquire(identity)).resolves.toEqual({
      kind: 'ACQUIRED',
      recordId: 'record-1',
    });
  });

  it.each([
    [{ ...identity, requestHash: 'b'.repeat(64) }, { kind: 'CONFLICT' }],
    [{ ...identity, status: 'IN_PROGRESS' }, { kind: 'IN_PROGRESS' }],
    [
      { ...identity, status: 'COMPLETED', responseCode: 201, responseBody: { success: true } },
      { kind: 'REPLAY', response: { statusCode: 201, body: { success: true } } },
    ],
  ])('resolves an existing record to the correct decision', async (existing, expected) => {
    create.mockRejectedValue({ code: 'P2002' });
    findUniqueOrThrow.mockResolvedValue(existing);
    await expect(repository.acquire(identity)).resolves.toEqual(expected);
  });

  it('completes only the acquired matching record', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await repository.complete('record-1', identity.requestHash, {
      statusCode: 201,
      body: { success: true },
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'record-1', requestHash: identity.requestHash, status: 'IN_PROGRESS' },
      }),
    );
  });

  it('rejects a lost or duplicate completion', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.complete('record-1', identity.requestHash, { statusCode: 200, body: null }),
    ).rejects.toThrow('IDEMPOTENCY_COMPLETION_REJECTED');
  });
});
