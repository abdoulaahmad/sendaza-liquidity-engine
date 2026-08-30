import { Injectable } from '@nestjs/common';
import { RegistryRepository } from './registry.repository';
import { AssetView, MarketView } from './registry.types';

@Injectable()
export class RegistryService {
  constructor(private readonly repository: RegistryRepository) {}

  listAssets(): readonly AssetView[] {
    return this.repository.listAssets();
  }

  listMarkets(): readonly MarketView[] {
    return this.repository.listMarkets();
  }
}
