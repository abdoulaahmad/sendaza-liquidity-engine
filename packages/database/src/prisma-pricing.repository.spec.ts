import { PrismaService } from './prisma.service';
import { PrismaPricingRepository } from './prisma-pricing.repository';

const decimal = (value: string) => ({ toFixed: () => value });

describe('PrismaPricingRepository', () => {
  const routeFindFirst = jest.fn();
  const observationFindMany = jest.fn();
  const observationCreate = jest.fn();
  const observationFindFirst = jest.fn();
  const snapshotFindFirst = jest.fn();
  const manualPriceFindFirst = jest.fn();
  const providerPairFindMany = jest.fn();
  const snapshotCreate = jest.fn();
  const inputCreateMany = jest.fn();
  const transaction = jest.fn(async (work: (client: unknown) => Promise<unknown>) =>
    work({
      referenceRateSnapshot: { create: snapshotCreate },
      referenceRateSnapshotInput: { createMany: inputCreateMany },
    }),
  );
  const prisma = {
    conversionRoute: { findFirst: routeFindFirst },
    priceObservation: {
      findMany: observationFindMany,
      findFirst: observationFindFirst,
      create: observationCreate,
    },
    referenceRateSnapshot: { findFirst: snapshotFindFirst },
    manualPriceVersion: { findFirst: manualPriceFindFirst },
    providerPricePair: { findMany: providerPairFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;
  const repository = new PrismaPricingRepository(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('maps an enabled route without leaking Prisma field names', async () => {
    routeFindFirst.mockResolvedValue({
      id: 'route-1',
      version: 2,
      outputScale: 2,
      maxAgeSeconds: 30,
      maxDeviationBps: 100,
      stablecoinGuardPairId: 'guard-pair',
      stablecoinExpectedRate: decimal('1.000000000000000000000000000000'),
      stablecoinToleranceBps: 50,
      legs: [
        {
          id: 'leg-1',
          sequence: 1,
          providerPricePairId: 'provider-pair',
          operation: 'MULTIPLY',
        },
      ],
    });

    await expect(repository.findEnabledRoute('market-1')).resolves.toEqual({
      id: 'route-1',
      version: 2,
      outputScale: 2,
      maxAgeSeconds: 30,
      maxDeviationBps: 100,
      stablecoinGuard: {
        providerPairId: 'guard-pair',
        expectedRate: '1.000000000000000000000000000000',
        toleranceBps: 50,
      },
      legs: [
        { id: 'leg-1', sequence: 1, providerPairId: 'provider-pair', operation: 'MULTIPLY' },
      ],
    });
  });

  it('returns the latest observations with pair safety configuration', async () => {
    const observedAt = new Date('2026-09-01T10:00:00.000Z');
    observationFindMany.mockResolvedValue([
      {
        id: 'observation-1',
        providerPricePairId: 'pair-1',
        normalizedRate: decimal('1600.120000000000000000000000000000'),
        providerObservedAt: observedAt,
        providerSequence: null,
        sequenceGap: false,
        deduplicationKey: 'dedupe-1',
        providerPricePair: { priceScale: 2, maxAgeSeconds: 60 },
      },
    ]);

    await expect(repository.findLatestObservations(['pair-1', 'pair-1'])).resolves.toEqual([
      {
        id: 'observation-1',
        providerPairId: 'pair-1',
        rate: '1600.120000000000000000000000000000',
        priceScale: 2,
        pairMaxAgeSeconds: 60,
        observedAt,
        deduplicationKey: 'dedupe-1',
        sequenceGap: false,
      },
    ]);
    expect(observationFindMany.mock.calls[0]?.[0].where.providerPricePairId.in).toEqual(['pair-1']);
  });

  it('inserts exact observation strings and returns the generated id', async () => {
    observationCreate.mockResolvedValue({ id: 'observation-1' });
    const providerObservedAt = new Date('2026-09-01T10:00:00.000Z');
    const receivedAt = new Date('2026-09-01T10:00:01.000Z');

    await expect(
      repository.insertObservation({
        providerPairId: 'pair-1',
        normalizedRate: '1600.12',
        rawRate: '1600.12',
        providerObservedAt,
        deduplicationKey: 'dedupe-1',
        receivedAt,
      }),
    ).resolves.toEqual({ id: 'observation-1', inserted: true });
    expect(observationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ normalizedRate: '1600.12' }) }),
    );
  });

  it('resolves a concurrent exact duplicate after PostgreSQL uniqueness wins', async () => {
    observationCreate.mockRejectedValue({ code: 'P2002' });
    observationFindFirst.mockResolvedValue({
      id: 'observation-existing',
      providerPricePairId: 'pair-1',
      normalizedRate: decimal('1600.25'),
      providerObservedAt: new Date('2026-09-01T10:00:00.000Z'),
      providerSequence: '7',
      sequenceGap: false,
      deduplicationKey: 'dedupe-1',
      providerPricePair: { priceScale: 2, maxAgeSeconds: 60 },
    });
    await expect(
      repository.insertObservation({
        providerPairId: 'pair-1',
        normalizedRate: '1600.25',
        rawRate: '1600.25',
        providerObservedAt: new Date('2026-09-01T10:00:00.000Z'),
        providerSequence: '7',
        deduplicationKey: 'dedupe-1',
        receivedAt: new Date('2026-09-01T10:00:01.000Z'),
      }),
    ).resolves.toEqual({ id: 'observation-existing', inserted: false });
  });

  it('loads sequence evidence needed by ingestion', async () => {
    observationFindFirst.mockResolvedValue({
      id: 'observation-1',
      providerPricePairId: 'pair-1',
      normalizedRate: decimal('1600.25'),
      providerObservedAt: new Date('2026-09-01T10:00:00.000Z'),
      providerSequence: '7',
      sequenceGap: true,
      deduplicationKey: 'dedupe-1',
      providerPricePair: { priceScale: 2, maxAgeSeconds: 60 },
    });
    await expect(repository.findLatestObservationForPair('pair-1')).resolves.toMatchObject({
      providerSequence: '7',
      sequenceGap: true,
      deduplicationKey: 'dedupe-1',
    });
    expect(observationFindFirst.mock.calls[0]?.[0].orderBy).toEqual({
      providerObservedAt: 'desc',
    });
  });

  it('loads only the active reviewed manual price version', async () => {
    const effectiveFrom = new Date('2026-09-01T09:00:00.000Z');
    manualPriceFindFirst.mockResolvedValue({
      normalizedRate: decimal('1600.250000000000000000000000000000'),
      effectiveFrom,
      version: 7,
    });
    await expect(
      repository.findActiveManualPrice('USD-NGN', new Date('2026-09-01T12:00:00.000Z')),
    ).resolves.toEqual({
      rate: '1600.250000000000000000000000000000',
      effectiveFrom,
      version: 7,
    });
    expect(manualPriceFindFirst.mock.calls[0]?.[0].where.providerPricePair.provider.type).toBe(
      'MANUAL',
    );
  });

  it('loads enabled provider sources without vendor configuration', async () => {
    providerPairFindMany.mockResolvedValue([
      {
        id: 'pair-1',
        providerPairCode: 'ETH-USDT',
        priceScale: 8,
        sequenceEnforced: false,
        provider: { type: 'COINBASE_PUBLIC' },
      },
    ]);
    await expect(repository.findProviderPairSources(['pair-1', 'pair-1'])).resolves.toEqual([
      {
        id: 'pair-1',
        providerPairCode: 'ETH-USDT',
        priceScale: 8,
        sequenceEnforced: false,
        providerKind: 'COINBASE_PUBLIC',
      },
    ]);
    expect(providerPairFindMany.mock.calls[0]?.[0].where.id.in).toEqual(['pair-1']);
  });

  it('stores an accepted snapshot and all evidence in one transaction', async () => {
    snapshotCreate.mockResolvedValue({ id: 'snapshot-1' });
    inputCreateMany.mockResolvedValue({ count: 1 });
    const calculatedAt = new Date('2026-09-01T10:00:00.000Z');
    const validUntil = new Date('2026-09-01T10:00:30.000Z');

    await expect(
      repository.saveEvaluation({
        status: 'ACCEPTED',
        routeId: 'route-1',
        routeVersion: 1,
        rate: '1600.12',
        outputScale: 2,
        roundingMode: 'HALF_EVEN',
        calculatedAt,
        validUntil,
        guardObservationId: 'guard-1',
        inputs: [{ routeLegId: 'leg-1', observationId: 'observation-1' }],
      }),
    ).resolves.toBe('snapshot-1');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(snapshotCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'ACCEPTED',
        rate: '1600.12',
        guardObservationId: 'guard-1',
      }),
      select: { id: true },
    });
    expect(inputCreateMany).toHaveBeenCalledWith({
      data: [
        {
          snapshotId: 'snapshot-1',
          routeLegId: 'leg-1',
          observationId: 'observation-1',
        },
      ],
    });
  });

  it('stores a rejected evaluation without a quoteable rate', async () => {
    snapshotCreate.mockResolvedValue({ id: 'snapshot-2' });
    await repository.saveEvaluation({
      status: 'REJECTED',
      routeId: 'route-1',
      routeVersion: 1,
      failureCode: 'PRICE_LEG_MISSING',
      outputScale: 2,
      roundingMode: 'HALF_EVEN',
      calculatedAt: new Date('2026-09-01T10:00:00.000Z'),
      inputs: [],
    });
    expect(snapshotCreate.mock.calls[0]?.[0].data).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'PRICE_LEG_MISSING',
    });
    expect(snapshotCreate.mock.calls[0]?.[0].data).not.toHaveProperty('rate');
    expect(inputCreateMany).not.toHaveBeenCalled();
  });
});
