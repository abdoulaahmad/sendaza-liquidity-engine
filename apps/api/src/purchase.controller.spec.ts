import { PurchaseError, PurchaseRepository, PurchaseService } from '../../../packages/domain/src';
import { PurchaseController } from './purchase.controller';

describe('PurchaseController', () => {
  const repository: PurchaseRepository = {
    createReservation: jest.fn(),
    settle: jest.fn(),
    findById: jest.fn(),
  };
  const service = new PurchaseService(repository);
  const controller = new PurchaseController(service);
  const id = '00000000-0000-4000-8000-000000000001';
  const request = { correlationId: 'correlation-1' };

  afterEach(() => jest.restoreAllMocks());

  it('creates a reservation through the stable response envelope', async () => {
    const data = { purchaseId: id, status: 'RESERVED' } as never;
    jest.spyOn(service, 'create').mockResolvedValueOnce(data);
    await expect(
      controller.create(
        {
          quoteId: id,
          customerReference: 'customer-1',
          clientLockReference: 'lock-1',
          clientReference: 'purchase-1',
        },
        request,
      ),
    ).resolves.toEqual({ success: true, data });
  });

  it('rejects client-controlled routing fields', async () => {
    await expect(
      controller.create(
        {
          quoteId: id,
          customerReference: 'customer-1',
          clientLockReference: 'lock-1',
          clientReference: 'purchase-1',
          assetNetworkId: id,
        },
        request,
      ),
    ).rejects.toMatchObject({ status: 400, response: { error: { code: 'INVALID_REQUEST_BODY' } } });
  });

  it('requires propagated correlation context', async () => {
    await expect(
      controller.create(
        {
          quoteId: id,
          customerReference: 'customer-1',
          clientLockReference: 'lock-1',
          clientReference: 'purchase-1',
        },
        {},
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: { code: 'CORRELATION_ID_REQUIRED' } },
    });
  });

  it('maps insufficient inventory to a conflict', async () => {
    jest
      .spyOn(service, 'create')
      .mockRejectedValueOnce(new PurchaseError('INSUFFICIENT_INVENTORY'));
    await expect(
      controller.create(
        {
          quoteId: id,
          customerReference: 'customer-1',
          clientLockReference: 'lock-1',
          clientReference: 'purchase-1',
        },
        request,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'INSUFFICIENT_INVENTORY' } },
    });
  });

  it('settles only a UUID purchase using explicit ledger evidence', async () => {
    const data = { purchaseId: id, status: 'COMPLETED' } as never;
    jest.spyOn(service, 'settle').mockResolvedValueOnce(data);
    await expect(
      controller.settle(
        id,
        {
          status: 'COMMITTED',
          clientSettlementReference: 'journal-1',
          settledAt: '2026-09-02T15:00:00.000Z',
        },
        request,
      ),
    ).resolves.toEqual({ success: true, data });
  });

  it('maps missing purchases to not found', async () => {
    jest.spyOn(service, 'get').mockRejectedValueOnce(new PurchaseError('PURCHASE_NOT_FOUND'));
    await expect(controller.get(id)).rejects.toMatchObject({
      status: 404,
      response: { error: { code: 'PURCHASE_NOT_FOUND' } },
    });
  });
});
