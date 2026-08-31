import {
  ConversionRouteDefinition,
  evaluateReferenceRate,
  StoredPriceObservation,
} from './market-data';

const now = new Date('2026-08-31T12:00:00.000Z');

const observation = (
  id: string,
  providerPairId: string,
  rate: string,
  overrides: Partial<StoredPriceObservation> = {},
): StoredPriceObservation => ({
  id,
  providerPairId,
  rate,
  priceScale: 8,
  pairMaxAgeSeconds: 60,
  observedAt: new Date('2026-08-31T11:59:50.000Z'),
  ...overrides,
});

const route = (overrides: Partial<ConversionRouteDefinition> = {}): ConversionRouteDefinition => ({
  id: 'route-1',
  version: 1,
  outputScale: 2,
  maxAgeSeconds: 30,
  maxDeviationBps: 500,
  legs: [
    { id: 'leg-1', sequence: 1, providerPairId: 'eth-usdt', operation: 'MULTIPLY' },
    { id: 'leg-2', sequence: 2, providerPairId: 'usdt-ngn', operation: 'MULTIPLY' },
  ],
  ...overrides,
});

describe('reference rate evaluation', () => {
  it('evaluates a multi-leg route with exact decimal arithmetic', () => {
    const result = evaluateReferenceRate(
      route(),
      [observation('obs-1', 'eth-usdt', '2500.12345678'), observation('obs-2', 'usdt-ngn', '1600.00000000')],
      now,
    );

    expect(result).toEqual({
      status: 'ACCEPTED',
      routeId: 'route-1',
      routeVersion: 1,
      rate: '4000197.53',
      outputScale: 2,
      roundingMode: 'HALF_EVEN',
      calculatedAt: now,
      validUntil: new Date('2026-08-31T12:00:20.000Z'),
      inputs: [
        { routeLegId: 'leg-1', observationId: 'obs-1' },
        { routeLegId: 'leg-2', observationId: 'obs-2' },
      ],
    });
  });

  it('supports division and rounds only the final result using half-even', () => {
    const result = evaluateReferenceRate(
      route({
        outputScale: 2,
        legs: [
          { id: 'leg-1', sequence: 1, providerPairId: 'one', operation: 'MULTIPLY' },
          { id: 'leg-2', sequence: 2, providerPairId: 'eight', operation: 'DIVIDE' },
        ],
      }),
      [observation('obs-1', 'one', '1.00000000'), observation('obs-2', 'eight', '8.00000000')],
      now,
    );
    expect(result.status).toBe('ACCEPTED');
    expect(result.status === 'ACCEPTED' && result.rate).toBe('0.12');
  });

  it('selects the latest observation for a provider pair', () => {
    const result = evaluateReferenceRate(
      route({ legs: [{ id: 'leg-1', sequence: 1, providerPairId: 'pair', operation: 'MULTIPLY' }] }),
      [
        observation('older', 'pair', '100.00000000', { observedAt: new Date('2026-08-31T11:59:40.000Z') }),
        observation('newer', 'pair', '101.00000000'),
      ],
      now,
    );
    expect(result.status === 'ACCEPTED' && result.inputs[0]?.observationId).toBe('newer');
  });

  it.each([
    ['missing', [], 'PRICE_LEG_MISSING'],
    [
      'stale',
      [observation('obs-1', 'eth-usdt', '2500.00000000', { observedAt: new Date('2026-08-31T11:59:00.000Z') })],
      'PRICE_LEG_STALE',
    ],
    [
      'sequence gap',
      [observation('obs-1', 'eth-usdt', '2500.00000000', { sequenceGap: true })],
      'PRICE_SEQUENCE_GAP',
    ],
    [
      'excess source precision',
      [observation('obs-1', 'eth-usdt', '2500.001', { priceScale: 2 })],
      'PRICE_OBSERVATION_INVALID',
    ],
  ])('rejects an unsafe %s leg', (_name, observations, failureCode) => {
    expect(evaluateReferenceRate(route(), observations, now)).toMatchObject({
      status: 'REJECTED',
      failureCode,
    });
  });

  it('rejects non-contiguous route legs', () => {
    const invalidRoute = route({
      legs: [{ id: 'leg-1', sequence: 2, providerPairId: 'pair', operation: 'MULTIPLY' }],
    });
    expect(evaluateReferenceRate(invalidRoute, [observation('obs', 'pair', '1.00000000')], now)).toMatchObject({
      status: 'REJECTED',
      failureCode: 'PRICE_ROUTE_INVALID',
    });
  });

  it('rejects deviation outside the configured basis-point limit', () => {
    const result = evaluateReferenceRate(
      route({
        maxDeviationBps: 100,
        legs: [{ id: 'leg-1', sequence: 1, providerPairId: 'pair', operation: 'MULTIPLY' }],
      }),
      [observation('obs', 'pair', '102.00000000')],
      now,
      { rate: '100.00' },
    );
    expect(result).toMatchObject({ status: 'REJECTED', failureCode: 'PRICE_ROUTE_DEVIATION' });
  });

  it('accepts a stablecoin reference exactly on the configured tolerance boundary', () => {
    const result = evaluateReferenceRate(
      route({
        legs: [{ id: 'leg-1', sequence: 1, providerPairId: 'asset-fiat', operation: 'MULTIPLY' }],
        stablecoinGuard: { providerPairId: 'usdt-usd', expectedRate: '1.00', toleranceBps: 100 },
      }),
      [observation('price', 'asset-fiat', '100.00000000'), observation('guard', 'usdt-usd', '0.99000000')],
      now,
    );
    expect(result.status).toBe('ACCEPTED');
    expect(result.status === 'ACCEPTED' && result.guardObservationId).toBe('guard');
  });

  it('rejects a depegged stablecoin reference', () => {
    const result = evaluateReferenceRate(
      route({
        legs: [{ id: 'leg-1', sequence: 1, providerPairId: 'asset-fiat', operation: 'MULTIPLY' }],
        stablecoinGuard: { providerPairId: 'usdt-usd', expectedRate: '1.00', toleranceBps: 100 },
      }),
      [observation('price', 'asset-fiat', '100.00000000'), observation('guard', 'usdt-usd', '0.98000000')],
      now,
    );
    expect(result).toMatchObject({
      status: 'REJECTED',
      failureCode: 'STABLECOIN_REFERENCE_UNSAFE',
    });
  });

  it.each(['1e3', '-1', '0', 'NaN', '1,000'])(
    'rejects malformed or non-positive rate %s',
    (rate) => {
      const result = evaluateReferenceRate(
        route({ legs: [{ id: 'leg-1', sequence: 1, providerPairId: 'pair', operation: 'MULTIPLY' }] }),
        [observation('obs', 'pair', rate)],
        now,
      );
      expect(result).toMatchObject({
        status: 'REJECTED',
        failureCode: 'PRICE_OBSERVATION_INVALID',
      });
    },
  );

  it('rejects a result that cannot fit the database rate column', () => {
    const result = evaluateReferenceRate(
      route({
        legs: [
          { id: 'leg-1', sequence: 1, providerPairId: 'large-a', operation: 'MULTIPLY' },
          { id: 'leg-2', sequence: 2, providerPairId: 'large-b', operation: 'MULTIPLY' },
        ],
      }),
      [
        observation('obs-a', 'large-a', '99999999999999999999.00000000'),
        observation('obs-b', 'large-b', '99999999999999999999.00000000'),
      ],
      now,
    );
    expect(result).toMatchObject({ status: 'REJECTED', failureCode: 'PRICE_ROUTE_INVALID' });
  });
});
