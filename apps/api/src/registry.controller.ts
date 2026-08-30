import { Controller, Get } from '@nestjs/common';
import { AssetView, MarketView, RegistryService } from '../../../packages/domain/src';

@Controller()
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  @Get('assets')
  assets(): { success: true; data: AssetView[] } {
    return { success: true, data: this.registry.listAssets() };
  }

  @Get('markets')
  markets(): { success: true; data: MarketView[] } {
    return { success: true, data: this.registry.listMarkets() };
  }
}
