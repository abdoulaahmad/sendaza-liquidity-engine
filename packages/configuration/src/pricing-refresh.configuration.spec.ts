import { PricingRefreshConfiguration } from './pricing-refresh.configuration';

describe('PricingRefreshConfiguration', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('loads bounded scheduler and provider settings', () => {
    process.env.SLE_PRICING_POLL_INTERVAL_MS = '500';
    process.env.SLE_PRICING_BATCH_SIZE = '20';
    process.env.SLE_PRICING_LEASE_SECONDS = '45';
    process.env.SLE_PRICE_PROVIDER_TIMEOUT_MS = '2500';
    expect(new PricingRefreshConfiguration()).toEqual({
      pollIntervalMs: 500,
      batchSize: 20,
      leaseSeconds: 45,
      providerTimeoutMs: 2500,
    });
  });

  it.each([
    ['SLE_PRICING_POLL_INTERVAL_MS', '99'],
    ['SLE_PRICING_BATCH_SIZE', '0'],
    ['SLE_PRICING_LEASE_SECONDS', '301'],
    ['SLE_PRICE_PROVIDER_TIMEOUT_MS', 'not-an-integer'],
  ])('rejects invalid %s', (name, value) => {
    process.env[name] = value;
    expect(() => new PricingRefreshConfiguration()).toThrow(name);
  });
});
