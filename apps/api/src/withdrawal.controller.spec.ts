import {
  WithdrawalError,
  WithdrawalRepository,
  WithdrawalService,
} from '../../../packages/domain/src';
import { WithdrawalController } from './withdrawal.controller';

describe('WithdrawalController', () => {
  const repository: WithdrawalRepository = {
    create: jest.fn(),
    cancel: jest.fn(),
    findById: jest.fn(),
  };
  const service = new WithdrawalService(repository);
  const controller = new WithdrawalController(service);
  const id = '00000000-0000-4000-8000-000000000001';
  const request = { correlationId: 'correlation-1' };
  const body = {
    feeQuoteId: id,
    customerReference: 'customer-1',
    clientLockReference: 'lock-1',
    clientReference: 'withdrawal-1',
    destinationAddress: '0x1111111111111111111111111111111111111111',
  };

  afterEach(() => jest.restoreAllMocks());

  it('creates a withdrawal through the stable response envelope', async () => {
    const data = { withdrawalId: id, status: 'CREATED' } as never;
    jest.spyOn(service, 'create').mockResolvedValueOnce(data);
    await expect(controller.create(body, request)).resolves.toEqual({ success: true, data });
  });

  it('rejects client-controlled routing fields', async () => {
    await expect(controller.create({ ...body, assetNetworkId: id }, request)).rejects.toMatchObject(
      { status: 400, response: { error: { code: 'INVALID_REQUEST_BODY' } } },
    );
  });

  it('requires propagated correlation context', async () => {
    await expect(controller.create(body, {})).rejects.toMatchObject({
      status: 400,
      response: { error: { code: 'CORRELATION_ID_REQUIRED' } },
    });
  });

  it('maps an expired fee quote to a conflict', async () => {
    jest.spyOn(service, 'create').mockRejectedValueOnce(new WithdrawalError('FEE_QUOTE_EXPIRED'));
    await expect(controller.create(body, request)).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'FEE_QUOTE_EXPIRED' } },
    });
  });

  it('maps missing withdrawals to not found', async () => {
    jest.spyOn(service, 'get').mockRejectedValueOnce(new WithdrawalError('WITHDRAWAL_NOT_FOUND'));
    await expect(controller.get(id)).rejects.toMatchObject({
      status: 404,
      response: { error: { code: 'WITHDRAWAL_NOT_FOUND' } },
    });
  });

  it('cancels only a UUID withdrawal', async () => {
    const data = { withdrawalId: id, status: 'CANCELLED' } as never;
    jest.spyOn(service, 'cancel').mockResolvedValueOnce(data);
    await expect(controller.cancel(id, request)).resolves.toEqual({ success: true, data });
  });

  it('maps a claimed submission job to a conflict on cancel', async () => {
    jest
      .spyOn(service, 'cancel')
      .mockRejectedValueOnce(new WithdrawalError('WITHDRAWAL_ALREADY_CLAIMED'));
    await expect(controller.cancel(id, request)).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'WITHDRAWAL_ALREADY_CLAIMED' } },
    });
  });
});
