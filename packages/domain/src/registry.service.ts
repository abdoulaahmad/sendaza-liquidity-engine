import { Injectable } from '@nestjs/common';
import { RegistryRepository } from './registry.repository';
import { AssetView, MarketView } from './registry.types';

@Injectable()
export class RegistryService {
  constructor(private readonly repository: RegistryRepository) {}

  async listAssets(): Promise<readonly AssetView[]> {
    return this.repository.listAssets();
  }

  async listMarkets(): Promise<readonly MarketView[]> {
    return this.repository.listMarkets();
  }
}
