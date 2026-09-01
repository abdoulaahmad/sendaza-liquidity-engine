import { PriceProviderError } from '../../../packages/domain/src';
import { CoinbasePriceProvider } from './coinbase-price.provider';
import { ManualPriceProvider } from './manual-price.provider';

const now = new Date('2026-09-01T12:00:00.000Z');

describe('CoinbasePriceProvider', () => {
  it('maps a public product response without numeric coercion', async () => {
    const fetchPrice = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ product_id: 'ETH-USDT', price: '4321.12345678' }),
    });
    const provider = new CoinbasePriceProvider(fetchPrice, 'https://coinbase.test/products', 500, () => now);

    await expect(provider.fetch({ providerPairCode: 'ETH-USDT' })).resolves.toEqual({
      price: '4321.12345678',
      observedAt: now,
    });
    expect(fetchPrice.mock.calls[0]?.[0]).toBe('https://coinbase.test/products/ETH-USDT');
  });

  it.each([
    [{ product_id: 'BTC-USDT', price: '1.00' }, 'PRICE_OBSERVATION_INVALID'],
    [{ product_id: 'ETH-USDT', price: 1 }, 'PRICE_OBSERVATION_INVALID'],
  ])('rejects malformed or mismatched evidence', async (body, code) => {
    const provider = new CoinbasePriceProvider(
      jest.fn().mockResolvedValue({ ok: true, json: async () => body }),
    );
    await expect(provider.fetch({ providerPairCode: 'ETH-USDT' })).rejects.toEqual(
      new PriceProviderError(code as 'PRICE_OBSERVATION_INVALID'),
    );
  });

  it('converts transport failures to a stable safe code', async () => {
    const provider = new CoinbasePriceProvider(jest.fn().mockRejectedValue(new Error('socket detail')));
    await expect(provider.fetch({ providerPairCode: 'ETH-USDT' })).rejects.toEqual(
      new PriceProviderError('PRICE_PROVIDER_UNAVAILABLE'),
    );
  });

  it('rejects an unsafe configured pair code before HTTP', async () => {
    const fetchPrice = jest.fn();
    const provider = new CoinbasePriceProvider(fetchPrice);
    await expect(provider.fetch({ providerPairCode: '../secret' })).rejects.toEqual(
      new PriceProviderError('PRICE_OBSERVATION_INVALID'),
    );
    expect(fetchPrice).not.toHaveBeenCalled();
  });
});

describe('ManualPriceProvider', () => {
  const findActiveManualPrice = jest.fn();
  const source = { findActiveManualPrice };
  const provider = new ManualPriceProvider(source, () => now);

  beforeEach(() => jest.resetAllMocks());

  it('maps the reviewed version into a sequenced observation', async () => {
    const effectiveFrom = new Date('2026-09-01T09:00:00.000Z');
    findActiveManualPrice.mockResolvedValue({ rate: '1600.25', effectiveFrom, version: 7 });
    await expect(provider.fetch({ providerPairCode: 'USD-NGN' })).resolves.toEqual({
      price: '1600.25',
      observedAt: effectiveFrom,
      providerSequence: '7',
    });
    expect(findActiveManualPrice).toHaveBeenCalledWith('USD-NGN', now);
  });

  it('fails closed when no reviewed version is active', async () => {
    findActiveManualPrice.mockResolvedValue(null);
    await expect(provider.fetch({ providerPairCode: 'USD-NGN' })).rejects.toEqual(
      new PriceProviderError('PRICE_PROVIDER_UNAVAILABLE'),
    );
  });
});
