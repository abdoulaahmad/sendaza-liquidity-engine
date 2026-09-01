import {
  MarketDataRefreshService,
  PriceProvider,
  PriceProviderResolver,
  PricingRepository,
  StoredPriceObservation,
} from './market-data';

const now = new Date('2026-09-01T12:00:00.000Z');
const route = {
  id: 'route-1',
  version: 1,
  outputScale: 2,
  maxAgeSeconds: 30,
  maxDeviationBps: 500,
  legs: [{ id: 'leg-1', sequence: 1, providerPairId: 'pair-1', operation: 'MULTIPLY' as const }],
};
const latest: StoredPriceObservation = {
  id: 'observation-1',
  providerPairId: 'pair-1',
  rate: '1600.25',
  priceScale: 2,
  pairMaxAgeSeconds: 60,
  observedAt: new Date('2026-09-01T11:59:59.000Z'),
};

describe('MarketDataRefreshService', () => {
  const findEnabledRoute = jest.fn();
  const findProviderPairSources = jest.fn();
  const findByDedupe = jest.fn();
  const findBySequence = jest.fn();
  const findLatestForPair = jest.fn();
  const insertObservation = jest.fn();
  const findLatestObservations = jest.fn();
  const findPreviousAcceptedRate = jest.fn();
  const saveEvaluation = jest.fn();
  const repository = {
    findEnabledRoute,
    findProviderPairSources,
    findObservationByDeduplicationKey: findByDedupe,
    findObservationByProviderSequence: findBySequence,
    findLatestObservationForPair: findLatestForPair,
    insertObservation,
    findLatestObservations,
    findPreviousAcceptedRate,
    saveEvaluation,
  } as unknown as PricingRepository;
  const fetchPrice = jest.fn();
  const provider = { fetch: fetchPrice } as PriceProvider;
  const resolve = jest.fn().mockReturnValue(provider);
  const providers = { resolve } as PriceProviderResolver;
  const service = new MarketDataRefreshService(repository, providers, () => now);

  beforeEach(() => {
    jest.clearAllMocks();
    findEnabledRoute.mockResolvedValue(route);
    findProviderPairSources.mockResolvedValue([
      {
        id: 'pair-1',
        providerPairCode: 'USDT-NGN',
        providerKind: 'MANUAL',
        priceScale: 2,
        sequenceEnforced: false,
      },
    ]);
    fetchPrice.mockResolvedValue({ price: '1600.25', observedAt: latest.observedAt });
    findByDedupe.mockResolvedValue(null);
    insertObservation.mockResolvedValue({ id: 'observation-1', inserted: true });
    findLatestObservations.mockResolvedValue([latest]);
    findPreviousAcceptedRate.mockResolvedValue(null);
    saveEvaluation.mockResolvedValue('snapshot-1');
  });

  it('connects provider fetch, ingestion, evaluation, and snapshot persistence', async () => {
    const result = await service.refreshMarket('market-1');
    expect(fetchPrice).toHaveBeenCalledWith({ providerPairCode: 'USDT-NGN' });
    expect(insertObservation).toHaveBeenCalledWith(
      expect.objectContaining({ normalizedRate: '1600.25' }),
    );
    expect(saveEvaluation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ACCEPTED', rate: '1600.25' }),
    );
    expect(result).toMatchObject({
      marketId: 'market-1',
      snapshotId: 'snapshot-1',
      providerFailures: 0,
      evaluation: { status: 'ACCEPTED' },
    });
  });

  it('uses previously stored fresh evidence after a provider timeout', async () => {
    fetchPrice.mockRejectedValue(new Error('provider details'));
    const result = await service.refreshMarket('market-1');
    expect(insertObservation).not.toHaveBeenCalled();
    expect(result.providerFailures).toBe(1);
    expect(result.evaluation.status).toBe('ACCEPTED');
  });

  it('stores a rejected snapshot when no current or historical evidence exists', async () => {
    fetchPrice.mockRejectedValue(new Error('timeout'));
    findLatestObservations.mockResolvedValue([]);
    const result = await service.refreshMarket('market-1');
    expect(result.evaluation).toMatchObject({
      status: 'REJECTED',
      failureCode: 'PRICE_LEG_MISSING',
    });
    expect(saveEvaluation).toHaveBeenCalledWith(result.evaluation);
  });

  it('does not hide a database persistence failure as provider unavailability', async () => {
    insertObservation.mockRejectedValue(new Error('database unavailable'));
    await expect(service.refreshMarket('market-1')).rejects.toThrow('database unavailable');
    expect(saveEvaluation).not.toHaveBeenCalled();
  });
});
