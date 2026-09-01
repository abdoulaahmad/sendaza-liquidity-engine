import {
  PriceObservationInput,
  PriceProvider,
  PriceProviderError,
  PriceRequest,
} from '../../../packages/domain/src';

interface HttpResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

type FetchPrice = (url: string, init: { signal: AbortSignal }) => Promise<HttpResponse>;

export class CoinbasePriceProvider implements PriceProvider {
  constructor(
    private readonly fetchPrice: FetchPrice = fetch,
    private readonly baseUrl = 'https://api.coinbase.com/api/v3/brokerage/market/products',
    private readonly timeoutMilliseconds = 3_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetch(request: PriceRequest): Promise<PriceObservationInput> {
    if (!/^[A-Z0-9][A-Z0-9-]{1,98}[A-Z0-9]$/.test(request.providerPairCode)) {
      throw new PriceProviderError('PRICE_OBSERVATION_INVALID');
    }
    try {
      const response = await this.fetchPrice(
        `${this.baseUrl}/${encodeURIComponent(request.providerPairCode)}`,
        { signal: AbortSignal.timeout(this.timeoutMilliseconds) },
      );
      if (!response.ok) throw new PriceProviderError('PRICE_PROVIDER_UNAVAILABLE');
      const body = await response.json();
      if (!isCoinbaseProduct(body) || body.product_id !== request.providerPairCode) {
        throw new PriceProviderError('PRICE_OBSERVATION_INVALID');
      }
      return { price: body.price, observedAt: this.now() };
    } catch (error: unknown) {
      if (error instanceof PriceProviderError) throw error;
      throw new PriceProviderError('PRICE_PROVIDER_UNAVAILABLE');
    }
  }
}

function isCoinbaseProduct(value: unknown): value is { product_id: string; price: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'product_id' in value &&
    typeof value.product_id === 'string' &&
    'price' in value &&
    typeof value.price === 'string'
  );
}
