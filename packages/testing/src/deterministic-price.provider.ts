import {
  PriceObservationInput,
  PriceProvider,
  PriceProviderError,
  PriceRequest,
} from '../../domain/src';

export class DeterministicPriceProvider implements PriceProvider {
  constructor(private readonly observations: ReadonlyMap<string, PriceObservationInput>) {}

  async fetch(request: PriceRequest): Promise<PriceObservationInput> {
    const observation = this.observations.get(request.providerPairCode);
    if (!observation) throw new PriceProviderError('PRICE_PROVIDER_UNAVAILABLE');
    return {
      ...observation,
      observedAt: new Date(observation.observedAt.getTime()),
    };
  }
}
