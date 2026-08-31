import { Controller, Get } from '@nestjs/common';
import { AssetView, MarketView, RegistryService } from '../../../packages/domain/src';
import { AuditOperation } from './audit-operation.decorator';

@Controller()
export class RegistryController {
  constructor(private readonly registry: RegistryService) {}

  @Get('assets')
  @AuditOperation('assets.list')
  async assets(): Promise<{ success: true; data: readonly AssetView[] }> {
    return { success: true, data: await this.registry.listAssets() };
  }

  @Get('markets')
  @AuditOperation('markets.list')
  async markets(): Promise<{ success: true; data: readonly MarketView[] }> {
    return { success: true, data: await this.registry.listMarkets() };
  }
}
