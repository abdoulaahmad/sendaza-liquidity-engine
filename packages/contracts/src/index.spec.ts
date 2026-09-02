import { ContractValidationError, parseCreateQuoteBody } from './index';

describe('parseCreateQuoteBody', () => {
  const valid = {
    side: 'BUY',
    marketId: '00000000-0000-4000-8000-000000000001',
    debitAmount: '200000.00',
  };

  it('accepts the exact purchase quote contract', () => {
    expect(parseCreateQuoteBody(valid)).toEqual(valid);
  });

  it.each([
    undefined,
    { ...valid, provider: 'client-selected' },
    { ...valid, side: 'SELL' },
    { ...valid, marketId: 'ETH-NGN' },
    { ...valid, debitAmount: 200000 },
    { ...valid, debitAmount: '2e5' },
  ])('rejects malformed or client-controlled input %#', (body) => {
    expect(() => parseCreateQuoteBody(body)).toThrow(ContractValidationError);
  });
});
