import {
  ContractValidationError,
  parseCreatePurchaseBody,
  parseCreateQuoteBody,
  parseSettlePurchaseBody,
} from './index';

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

describe('purchase contracts', () => {
  const create = {
    quoteId: '00000000-0000-4000-8000-000000000001',
    customerReference: 'customer-1',
    clientLockReference: 'lock-1',
    clientReference: 'purchase-1',
  };

  it('accepts only the exact reservation command', () => {
    expect(parseCreatePurchaseBody(create)).toEqual(create);
    expect(() => parseCreatePurchaseBody({ ...create, provider: 'client-selected' })).toThrow(
      ContractValidationError,
    );
    expect(() => parseCreatePurchaseBody({ ...create, quoteId: 'quote-1' })).toThrow(
      ContractValidationError,
    );
  });

  it('accepts committed and proven rollback settlement evidence', () => {
    const committed = {
      status: 'COMMITTED',
      clientSettlementReference: 'journal-1',
      settledAt: '2026-09-02T15:00:00.000Z',
    };
    expect(parseSettlePurchaseBody(committed)).toEqual(committed);
    expect(parseSettlePurchaseBody({ ...committed, status: 'ROLLED_BACK' })).toEqual({
      ...committed,
      status: 'ROLLED_BACK',
    });
  });

  it.each([
    {
      status: 'UNKNOWN',
      clientSettlementReference: 'journal-1',
      settledAt: '2026-09-02T15:00:00Z',
    },
    { status: 'COMMITTED', clientSettlementReference: '', settledAt: '2026-09-02T15:00:00Z' },
    { status: 'COMMITTED', clientSettlementReference: 'journal-1', settledAt: 'yesterday' },
    {
      status: 'COMMITTED',
      clientSettlementReference: 'journal-1',
      settledAt: '2026-09-02T15:00:00Z',
      releaseInventory: true,
    },
  ])('rejects unsafe settlement input %#', (body) => {
    expect(() => parseSettlePurchaseBody(body)).toThrow(ContractValidationError);
  });
});
