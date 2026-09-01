import { PriceProviderError } from '../../domain/src';
import { DeterministicPriceProvider } from './deterministic-price.provider';

describe('DeterministicPriceProvider', () => {
  const observedAt = new Date('2026-09-01T12:00:00.000Z');
  const provider = new DeterministicPriceProvider(
    new Map([['ETH-USDT', { price: '4321.12', observedAt, providerSequence: '10' }]]),
  );

  it('returns repeatable configured evidence', async () => {
    const result = await provider.fetch({ providerPairCode: 'ETH-USDT' });
    expect(result).toEqual({ price: '4321.12', observedAt, providerSequence: '10' });
    expect(result.observedAt).not.toBe(observedAt);
  });

  it('fails closed for an unconfigured pair', async () => {
    await expect(provider.fetch({ providerPairCode: 'SOL-USDT' })).rejects.toEqual(
      new PriceProviderError('PRICE_PROVIDER_UNAVAILABLE'),
    );
  });
});
