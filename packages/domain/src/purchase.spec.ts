import { PurchaseError, PurchaseRepository, PurchaseService, StoredPurchase } from './purchase';

describe('PurchaseService', () => {
  const now = new Date('2026-09-02T15:00:00.000Z');
  const stored: StoredPurchase = {
    id: 'purchase-1',
    quoteId: 'quote-1',
    assetNetworkId: 'asset-network-1',
    customerReference: 'customer-1',
    clientLockReference: 'lock-1',
    clientReference: 'buy-1',
    debitAtomic: 20_000_000n,
    debitDecimals: 2,
    creditAtomic: 32_500_000n,
    creditDecimals: 8,
    status: 'RESERVED',
    reservationExpiresAt: new Date('2026-09-02T15:01:00.000Z'),
    createdAt: now,
  };
  const createReservation = jest.fn();
  const settle = jest.fn();
  const findById = jest.fn();
  const repository: PurchaseRepository = { createReservation, settle, findById };
  const service = new PurchaseService(repository, 60, () => now);

  beforeEach(() => jest.clearAllMocks());

  it('creates a decimal-string view using repository-controlled evidence', async () => {
    createReservation.mockResolvedValue({ kind: 'SUCCESS', value: stored });
    await expect(
      service.create({
        quoteId: 'quote-1',
        customerReference: 'customer-1',
        clientLockReference: 'lock-1',
        clientReference: 'buy-1',
        correlationId: 'correlation-1',
      }),
    ).resolves.toMatchObject({
      purchaseId: 'purchase-1',
      status: 'RESERVED',
      debitAmount: '200000.00',
      creditAmount: '0.32500000',
    });
    expect(createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ reservationTtlSeconds: 60, createdAt: now }),
    );
  });

  it('preserves stable repository rejection codes', async () => {
    createReservation.mockResolvedValue({ kind: 'FAILURE', code: 'INSUFFICIENT_INVENTORY' });
    await expect(
      service.create({
        quoteId: 'quote-1',
        customerReference: 'customer-1',
        clientLockReference: 'lock-1',
        clientReference: 'buy-1',
        correlationId: 'correlation-1',
      }),
    ).rejects.toEqual(new PurchaseError('INSUFFICIENT_INVENTORY'));
  });

  it('returns the authoritative purchase state', async () => {
    findById.mockResolvedValue({ ...stored, status: 'COMPLETED', completedAt: now });
    await expect(service.get('purchase-1')).resolves.toMatchObject({
      status: 'COMPLETED',
      completedAt: now.toISOString(),
    });
  });
});
