import { NewStoredQuote } from '../../domain/src';
import { PrismaQuoteRepository } from './prisma-quote.repository';
import { PrismaService } from './prisma.service';

describe('PrismaQuoteRepository', () => {
  const marketFindFirst = jest.fn();
  const policyFindFirst = jest.fn();
  const snapshotFindFirst = jest.fn();
  const quoteCreate = jest.fn();
  const prisma = {
    market: { findFirst: marketFindFirst },
    quotePolicyVersion: { findFirst: policyFindFirst },
    referenceRateSnapshot: { findFirst: snapshotFindFirst },
    quote: { create: quoteCreate },
  } as unknown as PrismaService;
  const repository = new PrismaQuoteRepository(prisma);
  const at = new Date('2026-09-02T10:00:00.000Z');

  beforeEach(() => {
    jest.resetAllMocks();
    marketFindFirst.mockResolvedValue({
      id: 'market-1',
      defaultBackingAssetNetworkId: 'asset-network-1',
      baseAsset: { decimals: 18 },
      quoteFiat: { decimals: 2 },
    });
    policyFindFirst.mockResolvedValue({
      id: 'policy-1',
      configurationVersionId: 5,
      spreadBps: 100,
      fixedFeeAtomic: 100_000n,
      percentageFeeBps: 100,
      minTotalDebitAtomic: 100n,
      maxTotalDebitAtomic: 100_000_000n,
      quoteTtlSeconds: 15,
      rateDisplayScale: 4,
    });
    snapshotFindFirst.mockResolvedValue({
      id: 'snapshot-1',
      rate: { toFixed: () => '6000000.0000' },
      validUntil: new Date('2026-09-02T10:00:30.000Z'),
    });
    quoteCreate.mockResolvedValue({ id: 'quote-1' });
  });

  it('loads enabled market, active policy, and newest fresh accepted snapshot', async () => {
    await expect(repository.loadCreationContext('market-1', at)).resolves.toEqual({
      kind: 'READY',
      context: expect.objectContaining({
        marketId: 'market-1',
        quoteFiatDecimals: 2,
        baseAssetDecimals: 18,
        policy: expect.objectContaining({ id: 'policy-1' }),
        snapshot: {
          id: 'snapshot-1',
          rate: '6000000.0000',
          validUntil: new Date('2026-09-02T10:00:30.000Z'),
        },
      }),
    });
    expect(policyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ marketId: 'market-1', status: 'ACTIVE' }),
      }),
    );
    expect(snapshotFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'ACCEPTED', validUntil: { gt: at } }),
        orderBy: { calculatedAt: 'desc' },
      }),
    );
  });

  it.each([
    ['market', marketFindFirst, 'MARKET_UNAVAILABLE'],
    ['policy', policyFindFirst, 'POLICY_UNAVAILABLE'],
    ['snapshot', snapshotFindFirst, 'REFERENCE_UNAVAILABLE'],
  ])('returns a stable unavailable result for missing %s', async (_name, mock, kind) => {
    mock.mockResolvedValueOnce(null);
    await expect(repository.loadCreationContext('market-1', at)).resolves.toEqual({ kind });
  });

  it('inserts every immutable quote evidence field without recalculation', async () => {
    const quote: NewStoredQuote = {
      id: 'quote-1',
      side: 'BUY',
      marketId: 'market-1',
      backingAssetNetworkId: 'asset-network-1',
      referenceRateSnapshotId: 'snapshot-1',
      quotePolicyVersionId: 'policy-1',
      configurationVersionId: 5,
      totalDebitAtomic: 20_000_000n,
      fixedFeeAtomic: 100_000n,
      percentageFeeAtomic: 200_000n,
      percentageFeeBps: 100,
      totalFeeAtomic: 300_000n,
      tradeAmountAtomic: 19_700_000n,
      spreadBps: 100,
      spreadAmountAtomic: 195_049n,
      destinationAmountAtomic: 32_508_250_825_082_508n,
      quoteFiatDecimals: 2,
      baseAssetDecimals: 18,
      referenceRate: '6000000.0000',
      customerRate: '6060000.000000000000000000000000000000',
      rateDisplayScale: 4,
      feeRoundingMode: 'CEILING',
      destinationRoundingMode: 'FLOOR',
      expiresAt: new Date('2026-09-02T10:00:15.000Z'),
      createdAt: at,
    };
    await repository.insertQuote(quote);
    expect(quoteCreate).toHaveBeenCalledWith({ data: quote, select: { id: true } });
  });
});
