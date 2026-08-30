import { Controller, Get } from '@nestjs/common';
import { AssetView, MarketView, RegistryService } from '../../../packages/domain/src';

@Controller()
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  @Get('assets')
  async assets(): Promise<{ success: true; data: readonly AssetView[] }> {
    return { success: true, data: await this.registry.listAssets() };
  }

  @Get('markets')
  async markets(): Promise<{ success: true; data: readonly MarketView[] }> {
    return { success: true, data: await this.registry.listMarkets() };
  }
}
