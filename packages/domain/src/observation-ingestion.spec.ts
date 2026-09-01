import {
  createObservationDeduplicationKey,
  ObservationIngestionService,
  PriceProviderError,
  PricingRepository,
  StoredPriceObservation,
} from './market-data';

const receivedAt = new Date('2026-09-01T12:00:00.000Z');
const policy = { id: 'pair-1', priceScale: 2, sequenceEnforced: true };
const input = {
  price: '1600.25',
  observedAt: new Date('2026-09-01T11:59:59.000Z'),
  providerSequence: '11',
};

const stored = (overrides: Partial<StoredPriceObservation> = {}): StoredPriceObservation => ({
  id: 'observation-previous',
  providerPairId: 'pair-1',
  rate: '1600.00',
  priceScale: 2,
  pairMaxAgeSeconds: 60,
  observedAt: new Date('2026-09-01T11:59:58.000Z'),
  providerSequence: '10',
  ...overrides,
});

describe('ObservationIngestionService', () => {
  const findByDedupe = jest.fn();
  const findBySequence = jest.fn();
  const findLatest = jest.fn();
  const insertObservation = jest.fn();
  const repository = {
    findObservationByDeduplicationKey: findByDedupe,
    findObservationByProviderSequence: findBySequence,
    findLatestObservationForPair: findLatest,
    insertObservation,
  } as unknown as PricingRepository;
  const service = new ObservationIngestionService(repository);

  beforeEach(() => {
    jest.resetAllMocks();
    findByDedupe.mockResolvedValue(null);
    findBySequence.mockResolvedValue(null);
    findLatest.mockResolvedValue(stored());
    insertObservation.mockResolvedValue({ id: 'observation-new', inserted: true });
  });

  it('stores the next exact sequence with a deterministic evidence hash', async () => {
    await expect(service.ingest(policy, input, receivedAt)).resolves.toEqual({
      status: 'INSERTED',
      observationId: 'observation-new',
    });
    expect(insertObservation).toHaveBeenCalledWith({
      providerPairId: 'pair-1',
      normalizedRate: '1600.25',
      rawRate: '1600.25',
      providerObservedAt: input.observedAt,
      providerSequence: '11',
      deduplicationKey: createObservationDeduplicationKey('pair-1', input),
      receivedAt,
    });
    expect(createObservationDeduplicationKey('pair-1', input)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns an existing exact duplicate without another insert', async () => {
    findByDedupe.mockResolvedValue(stored({ id: 'existing' }));
    await expect(service.ingest(policy, input, receivedAt)).resolves.toEqual({
      status: 'DUPLICATE',
      observationId: 'existing',
    });
    expect(insertObservation).not.toHaveBeenCalled();
  });

  it('treats a concurrent database winner as an exact duplicate', async () => {
    insertObservation.mockResolvedValue({ id: 'concurrent-winner', inserted: false });
    await expect(service.ingest(policy, input, receivedAt)).resolves.toEqual({
      status: 'DUPLICATE',
      observationId: 'concurrent-winner',
    });
  });

  it('rejects the same sequence carrying different evidence', async () => {
    findBySequence.mockResolvedValue(stored({ providerSequence: '11' }));
    await expect(service.ingest(policy, input, receivedAt)).rejects.toEqual(
      new PriceProviderError('PRICE_OBSERVATION_INVALID'),
    );
  });

  it.each(['12', '9'])('persists sequence %s as unsafe evidence', async (providerSequence) => {
    const result = await service.ingest(policy, { ...input, providerSequence }, receivedAt);
    expect(result).toEqual({ status: 'SEQUENCE_GAP', observationId: 'observation-new' });
    expect(insertObservation).toHaveBeenCalledWith(
      expect.objectContaining({ providerSequence, sequenceGap: true }),
    );
  });

  it('accepts an unsequenced provider without sequence lookups', async () => {
    const result = await service.ingest(
      { ...policy, sequenceEnforced: false },
      { price: '1600.25', observedAt: input.observedAt },
      receivedAt,
    );
    expect(result.status).toBe('INSERTED');
    expect(findBySequence).not.toHaveBeenCalled();
    expect(findLatest).not.toHaveBeenCalled();
  });

  it.each([
    ['excess precision', { ...input, price: '1600.251' }],
    ['scientific notation', { ...input, price: '1e3' }],
    ['missing sequence', { price: '1600.25', observedAt: input.observedAt }],
    [
      'far future time',
      { ...input, observedAt: new Date('2026-09-01T12:05:00.001Z') },
    ],
    ['zero sequence', { ...input, providerSequence: '0' }],
  ])('rejects %s before persistence', async (_name, invalidInput) => {
    await expect(service.ingest(policy, invalidInput, receivedAt)).rejects.toEqual(
      new PriceProviderError('PRICE_OBSERVATION_INVALID'),
    );
    expect(insertObservation).not.toHaveBeenCalled();
  });
});
