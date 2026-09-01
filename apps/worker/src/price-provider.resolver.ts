import {
  PriceProvider,
  PriceProviderKind,
  PriceProviderResolver,
} from '../../../packages/domain/src';
import { CoinbasePriceProvider } from './coinbase-price.provider';
import { ManualPriceProvider } from './manual-price.provider';

export class WorkerPriceProviderResolver implements PriceProviderResolver {
  private readonly providers: ReadonlyMap<PriceProviderKind, PriceProvider>;

  constructor(coinbase: CoinbasePriceProvider, manual: ManualPriceProvider) {
    this.providers = new Map<PriceProviderKind, PriceProvider>([
      ['COINBASE_PUBLIC', coinbase],
      ['MANUAL', manual],
    ]);
  }

  resolve(kind: PriceProviderKind): PriceProvider | null {
    return this.providers.get(kind) ?? null;
  }
}
