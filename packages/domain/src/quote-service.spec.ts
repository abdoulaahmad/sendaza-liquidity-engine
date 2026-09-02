import {
  NewStoredQuote,
  QuoteContextResult,
  QuoteCreationError,
  QuoteRepository,
  QuoteService,
  ReadyQuoteContext,
} from './quote-service';

const now = new Date('2026-09-02T10:00:00.000Z');
const context = (overrides: Partial<ReadyQuoteContext> = {}): ReadyQuoteContext => ({
  marketId: 'market-1',
  backingAssetNetworkId: 'asset-network-1',
  quoteFiatDecimals: 2,
  baseAssetDecimals: 18,
  policy: {
    id: 'policy-1',
    configurationVersionId: 5,
    spreadBps: 100,
    fixedFeeAtomic: 100_000n,
    percentageFeeBps: 100,
    minTotalDebitAtomic: 100n,
    maxTotalDebitAtomic: 100_000_000n,
    quoteTtlSeconds: 15,
    rateDisplayScale: 4,
  },
  snapshot: {
    id: 'snapshot-1',
    rate: '6000000.0000',
    validUntil: new Date('2026-09-02T10:00:30.000Z'),
  },
  ...overrides,
});

describe('QuoteService', () => {
  const loadCreationContext = jest.fn<Promise<QuoteContextResult>, [string, Date]>();
  const insertQuote = jest.fn<Promise<void>, [NewStoredQuote]>();
  const repository = { loadCreationContext, insertQuote } as QuoteRepository;
  const service = new QuoteService(repository, () => now);

  beforeEach(() => {
    jest.resetAllMocks();
    loadCreationContext.mockResolvedValue({ kind: 'READY', context: context() });
    insertQuote.mockResolvedValue(undefined);
  });

  it('creates and persists one immutable quote view from server-controlled evidence', async () => {
    await expect(
      service.createBuyQuote({ marketId: 'market-1', debitAmount: '200000.00' }),
    ).resolves.toEqual({
      quoteId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      side: 'BUY',
      marketId: 'market-1',
      debitAmount: '200000.00',
      tradeAmount: '197000.00',
      fixedFeeAmount: '1000.00',
      percentageFeeAmount: '2000.00',
      totalFeeAmount: '3000.00',
      referenceRate: '6000000.0000',
      customerRate: '6060000.0000',
      spreadAmount: '1950.49',
      destinationAmount: '0.032508250825082508',
      expiresAt: '2026-09-02T10:00:15.000Z',
      configurationVersion: 5,
    });
    expect(loadCreationContext).toHaveBeenCalledWith('market-1', now);
    expect(insertQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        marketId: 'market-1',
        referenceRateSnapshotId: 'snapshot-1',
        quotePolicyVersionId: 'policy-1',
        totalDebitAtomic: 20_000_000n,
        destinationAmountAtomic: 32_508_250_825_082_508n,
        expiresAt: new Date('2026-09-02T10:00:15.000Z'),
        createdAt: now,
      }),
    );
  });

  it('never extends the reference snapshot expiry', async () => {
    loadCreationContext.mockResolvedValue({
      kind: 'READY',
      context: context({
        snapshot: {
          id: 'snapshot-1',
          rate: '6000000.0000',
          validUntil: new Date('2026-09-02T10:00:05.000Z'),
        },
      }),
    });
    await expect(
      service.createBuyQuote({ marketId: 'market-1', debitAmount: '200000.00' }),
    ).resolves.toMatchObject({ expiresAt: '2026-09-02T10:00:05.000Z' });
  });

  it.each([
    ['MARKET_UNAVAILABLE', 'MARKET_DISABLED'],
    ['POLICY_UNAVAILABLE', 'QUOTE_POLICY_UNAVAILABLE'],
    ['REFERENCE_UNAVAILABLE', 'REFERENCE_RATE_UNAVAILABLE'],
  ] as const)('maps %s context to %s', async (kind, code) => {
    loadCreationContext.mockResolvedValue({ kind });
    await expect(
      service.createBuyQuote({ marketId: 'market-1', debitAmount: '200000.00' }),
    ).rejects.toEqual(expect.objectContaining({ code }) as QuoteCreationError);
    expect(insertQuote).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed', '20,000', 'AMOUNT_INVALID'],
    ['excess precision', '200000.001', 'AMOUNT_EXCESS_PRECISION'],
    ['below limit', '0.99', 'ORDER_BELOW_MINIMUM'],
  ])('rejects %s debit before persistence', async (_name, debitAmount, code) => {
    await expect(service.createBuyQuote({ marketId: 'market-1', debitAmount })).rejects.toEqual(
      expect.objectContaining({ code }) as QuoteCreationError,
    );
    expect(insertQuote).not.toHaveBeenCalled();
  });

  it('rejects a snapshot that expires at the transaction time', async () => {
    loadCreationContext.mockResolvedValue({
      kind: 'READY',
      context: context({
        snapshot: { id: 'snapshot-1', rate: '6000000.0000', validUntil: now },
      }),
    });
    await expect(
      service.createBuyQuote({ marketId: 'market-1', debitAmount: '200000.00' }),
    ).rejects.toEqual(
      expect.objectContaining({ code: 'REFERENCE_RATE_EXPIRED' }) as QuoteCreationError,
    );
  });

  it('does not hide a database evidence-race rejection', async () => {
    insertQuote.mockRejectedValue(new Error('quote policy is not active for market'));
    await expect(
      service.createBuyQuote({ marketId: 'market-1', debitAmount: '200000.00' }),
    ).rejects.toThrow('quote policy is not active for market');
  });
});
