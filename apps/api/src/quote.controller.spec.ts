import { QuoteCreationError, QuoteRepository, QuoteService } from '../../../packages/domain/src';
import { QuoteController } from './quote.controller';

describe('QuoteController', () => {
  const repository: QuoteRepository = {
    loadCreationContext: jest.fn(),
    insertQuote: jest.fn(),
  };
  const service = new QuoteService(repository);
  const controller = new QuoteController(service);

  it('returns the stable response envelope', async () => {
    const data = { quoteId: 'quote-1' } as never;
    jest.spyOn(service, 'createBuyQuote').mockResolvedValueOnce(data);
    await expect(
      controller.create({
        side: 'BUY',
        marketId: '00000000-0000-4000-8000-000000000001',
        debitAmount: '200000.00',
      }),
    ).resolves.toEqual({ success: true, data });
  });

  it('rejects unknown request fields', async () => {
    await expect(
      controller.create({
        side: 'BUY',
        marketId: '00000000-0000-4000-8000-000000000001',
        debitAmount: '200000.00',
        provider: 'chosen-by-client',
      }),
    ).rejects.toMatchObject({ status: 400, response: { error: { code: 'INVALID_REQUEST_BODY' } } });
  });

  it('maps stale reference evidence to a retryable availability failure', async () => {
    jest
      .spyOn(service, 'createBuyQuote')
      .mockRejectedValueOnce(new QuoteCreationError('REFERENCE_RATE_EXPIRED'));
    await expect(
      controller.create({
        side: 'BUY',
        marketId: '00000000-0000-4000-8000-000000000001',
        debitAmount: '200000.00',
      }),
    ).rejects.toMatchObject({
      status: 503,
      response: { error: { code: 'REFERENCE_RATE_EXPIRED' } },
    });
  });
});
