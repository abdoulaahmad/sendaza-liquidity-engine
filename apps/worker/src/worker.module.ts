import { Module } from '@nestjs/common';
import { SendazaWebhookConfiguration } from '../../../packages/configuration/src';
import { PricingRefreshConfiguration } from '../../../packages/configuration/src';
import { DatabaseModule } from '../../../packages/database/src';
import {
  OutboxDeliveryService,
  OutboxPublisher,
  OutboxRepository,
  MarketDataRefreshService,
  PriceProviderResolver,
  PricingRefreshBatchService,
  PricingRefreshJobRepository,
  PricingRepository,
} from '../../../packages/domain/src';
import { OutboxWorker } from './outbox.worker';
import { SendazaWebhookPublisher } from './sendaza-webhook.publisher';
import { CoinbasePriceProvider } from './coinbase-price.provider';
import { ManualPriceProvider } from './manual-price.provider';
import { WorkerPriceProviderResolver } from './price-provider.resolver';
import { PricingRefreshWorker } from './pricing-refresh.worker';

@Module({
  imports: [DatabaseModule],
  providers: [
    SendazaWebhookConfiguration,
    PricingRefreshConfiguration,
    SendazaWebhookPublisher,
    { provide: OutboxPublisher, useExisting: SendazaWebhookPublisher },
    {
      provide: OutboxDeliveryService,
      useFactory: (repository: OutboxRepository, publisher: OutboxPublisher) =>
        new OutboxDeliveryService(repository, publisher),
      inject: [OutboxRepository, OutboxPublisher],
    },
    OutboxWorker,
    {
      provide: CoinbasePriceProvider,
      useFactory: (configuration: PricingRefreshConfiguration) =>
        new CoinbasePriceProvider(
          fetch,
          'https://api.coinbase.com/api/v3/brokerage/market/products',
          configuration.providerTimeoutMs,
        ),
      inject: [PricingRefreshConfiguration],
    },
    {
      provide: ManualPriceProvider,
      useFactory: (repository: PricingRepository) => new ManualPriceProvider(repository),
      inject: [PricingRepository],
    },
    {
      provide: PriceProviderResolver,
      useFactory: (coinbase: CoinbasePriceProvider, manual: ManualPriceProvider) =>
        new WorkerPriceProviderResolver(coinbase, manual),
      inject: [CoinbasePriceProvider, ManualPriceProvider],
    },
    {
      provide: MarketDataRefreshService,
      useFactory: (repository: PricingRepository, providers: PriceProviderResolver) =>
        new MarketDataRefreshService(repository, providers),
      inject: [PricingRepository, PriceProviderResolver],
    },
    {
      provide: PricingRefreshBatchService,
      useFactory: (
        jobs: PricingRefreshJobRepository,
        refresh: MarketDataRefreshService,
        configuration: PricingRefreshConfiguration,
      ) =>
        new PricingRefreshBatchService(
          jobs,
          refresh,
          configuration.batchSize,
          configuration.leaseSeconds,
        ),
      inject: [
        PricingRefreshJobRepository,
        MarketDataRefreshService,
        PricingRefreshConfiguration,
      ],
    },
    PricingRefreshWorker,
  ],
})
export class WorkerModule {}
