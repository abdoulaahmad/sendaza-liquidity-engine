import { NetworkFeeRepository, WithdrawalFeeQuoteService } from '../../../packages/domain/src';
import { WithdrawalFeeQuoteController } from './withdrawal-fee-quote.controller';

describe('WithdrawalFeeQuoteController', () => {
  const repository = {} as NetworkFeeRepository;
  const service = new WithdrawalFeeQuoteService(repository);
  const controller = new WithdrawalFeeQuoteController(service);
  const body = {
    assetNetworkId: '00000000-0000-4000-8000-000000000001',
    transferType: 'TOKEN' as const,
    amount: '25.000000',
    destinationAddress: '0xabc123',
    customerReference: 'customer-1',
  };

  afterEach(() => jest.restoreAllMocks());

  it('returns the stable response envelope', async () => {
    const data = { feeQuoteId: 'quote-1' } as never;
    jest.spyOn(service, 'create').mockResolvedValueOnce(data);
    await expect(controller.create(body)).resolves.toEqual({ success: true, data });
  });

  it('rejects a client-selected estimator', async () => {
    await expect(controller.create({ ...body, estimator: 'cheap-one' })).rejects.toMatchObject({
      status: 400,
      response: { error: { code: 'INVALID_REQUEST_BODY' } },
    });
  });
});
