import {
  PriceObservationInput,
  PricingRepository,
  PriceProvider,
  PriceProviderError,
  PriceRequest,
} from '../../../packages/domain/src';

export class ManualPriceProvider implements PriceProvider {
  constructor(
    private readonly source: Pick<PricingRepository, 'findActiveManualPrice'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetch(request: PriceRequest): Promise<PriceObservationInput> {
    const at = this.now();
    const active = await this.source.findActiveManualPrice(request.providerPairCode, at);
    if (!active) throw new PriceProviderError('PRICE_PROVIDER_UNAVAILABLE');
    return {
      price: active.rate,
      observedAt: active.effectiveFrom,
      providerSequence: active.version.toString(),
    };
  }
}
