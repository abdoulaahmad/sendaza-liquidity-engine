import { Module } from '@nestjs/common';
import { SendazaWebhookConfiguration } from '../../../packages/configuration/src';
import { PricingRefreshConfiguration } from '../../../packages/configuration/src';
import { TreasurySyncConfiguration } from '../../../packages/configuration/src';
import { PurchaseConfiguration } from '../../../packages/configuration/src';
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
  ChainBalanceProviderResolver,
  CustodyProviderResolver,
  TreasuryRepository,
  TreasurySynchronizationService,
  TreasurySyncBatchService,
  TreasurySyncJobRepository,
  PurchaseTimeoutBatchService,
  PurchaseTimeoutRepository,
} from '../../../packages/domain/src';
import { OutboxWorker } from './outbox.worker';
import { SendazaWebhookPublisher } from './sendaza-webhook.publisher';
import { CoinbasePriceProvider } from './coinbase-price.provider';
import { ManualPriceProvider } from './manual-price.provider';
import { WorkerPriceProviderResolver } from './price-provider.resolver';
import { PricingRefreshWorker } from './pricing-refresh.worker';
import { DeterministicFakeCustodyProvider } from './fake-custody.provider';
import {
  WorkerChainBalanceProviderResolver,
  WorkerCustodyProviderResolver,
} from './treasury-provider.resolver';
import { TreasurySyncWorker } from './treasury-sync.worker';
import { PurchaseTimeoutWorker } from './purchase-timeout.worker';
import { NetworkFeeConfiguration } from '../../../packages/configuration/src';
import {
  NetworkFeeEstimator,
  NetworkFeeEstimatorResolver,
  NetworkFeeRefreshBatchService,
  NetworkFeeRefreshJobRepository,
  NetworkFeeRefreshService,
  NetworkFeeRepository,
} from '../../../packages/domain/src';
import {
  DeterministicNetworkFeeEstimator,
  WorkerNetworkFeeEstimatorResolver,
} from './network-fee-estimator';
import { NetworkFeeRefreshWorker } from './network-fee-refresh.worker';
import { WithdrawalConfiguration } from '../../../packages/configuration/src';
import {
  CustodyTransferProvider,
  WithdrawalRecoveryBatchService,
  WithdrawalSubmissionBatchService,
  WithdrawalSubmissionJobRepository,
} from '../../../packages/domain/src';
import { DeterministicFakeCustodyTransferProvider } from './fake-custody-transfer.provider';
import { WithdrawalSubmissionWorker } from './withdrawal-submission.worker';
import { WithdrawalRecoveryWorker } from './withdrawal-recovery.worker';

@Module({
  imports: [DatabaseModule],
  providers: [
    SendazaWebhookConfiguration,
    PricingRefreshConfiguration,
    TreasurySyncConfiguration,
    PurchaseConfiguration,
    NetworkFeeConfiguration,
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
      inject: [PricingRefreshJobRepository, MarketDataRefreshService, PricingRefreshConfiguration],
    },
    PricingRefreshWorker,
    {
      provide: DeterministicFakeCustodyProvider,
      useValue: new DeterministicFakeCustodyProvider(new Map()),
    },
    {
      provide: CustodyProviderResolver,
      useFactory: (
        configuration: TreasurySyncConfiguration,
        fake: DeterministicFakeCustodyProvider,
      ) => new WorkerCustodyProviderResolver(configuration, fake),
      inject: [TreasurySyncConfiguration, DeterministicFakeCustodyProvider],
    },
    {
      provide: ChainBalanceProviderResolver,
      useFactory: (configuration: TreasurySyncConfiguration) =>
        new WorkerChainBalanceProviderResolver(configuration),
      inject: [TreasurySyncConfiguration],
    },
    {
      provide: TreasurySynchronizationService,
      useFactory: (
        repository: TreasuryRepository,
        custody: CustodyProviderResolver,
        chains: ChainBalanceProviderResolver,
      ) => new TreasurySynchronizationService(repository, custody, chains),
      inject: [TreasuryRepository, CustodyProviderResolver, ChainBalanceProviderResolver],
    },
    {
      provide: TreasurySyncBatchService,
      useFactory: (
        jobs: TreasurySyncJobRepository,
        repository: TreasuryRepository,
        synchronization: TreasurySynchronizationService,
        configuration: TreasurySyncConfiguration,
      ) =>
        new TreasurySyncBatchService(
          jobs,
          repository,
          synchronization,
          configuration.batchSize,
          configuration.leaseSeconds,
          configuration.refreshSeconds,
          configuration.retrySeconds,
        ),
      inject: [
        TreasurySyncJobRepository,
        TreasuryRepository,
        TreasurySynchronizationService,
        TreasurySyncConfiguration,
      ],
    },
    TreasurySyncWorker,
    {
      provide: PurchaseTimeoutBatchService,
      useFactory: (jobs: PurchaseTimeoutRepository, configuration: PurchaseConfiguration) =>
        new PurchaseTimeoutBatchService(
          jobs,
          configuration.timeoutBatchSize,
          configuration.timeoutLeaseSeconds,
        ),
      inject: [PurchaseTimeoutRepository, PurchaseConfiguration],
    },
    PurchaseTimeoutWorker,
    {
      provide: 'PROVIDER_NETWORK_FEE_ESTIMATOR',
      useFactory: (configuration: NetworkFeeConfiguration) =>
        new DeterministicNetworkFeeEstimator('PROVIDER', configuration.fakeProviderFeeAtomic),
      inject: [NetworkFeeConfiguration],
    },
    {
      provide: 'RPC_NETWORK_FEE_ESTIMATOR',
      useFactory: (configuration: NetworkFeeConfiguration) =>
        new DeterministicNetworkFeeEstimator('RPC', configuration.fakeRpcFeeAtomic),
      inject: [NetworkFeeConfiguration],
    },
    {
      provide: NetworkFeeEstimatorResolver,
      useFactory: (provider: NetworkFeeEstimator, rpc: NetworkFeeEstimator) =>
        new WorkerNetworkFeeEstimatorResolver(provider, rpc),
      inject: ['PROVIDER_NETWORK_FEE_ESTIMATOR', 'RPC_NETWORK_FEE_ESTIMATOR'],
    },
    {
      provide: NetworkFeeRefreshService,
      useFactory: (repository: NetworkFeeRepository, estimators: NetworkFeeEstimatorResolver) =>
        new NetworkFeeRefreshService(repository, estimators),
      inject: [NetworkFeeRepository, NetworkFeeEstimatorResolver],
    },
    {
      provide: NetworkFeeRefreshBatchService,
      useFactory: (
        jobs: NetworkFeeRefreshJobRepository,
        refresh: NetworkFeeRefreshService,
        configuration: NetworkFeeConfiguration,
      ) =>
        new NetworkFeeRefreshBatchService(
          jobs,
          refresh,
          configuration.batchSize,
          configuration.leaseSeconds,
          configuration.retrySeconds,
        ),
      inject: [NetworkFeeRefreshJobRepository, NetworkFeeRefreshService, NetworkFeeConfiguration],
    },
    NetworkFeeRefreshWorker,
    WithdrawalConfiguration,
    {
      provide: CustodyTransferProvider,
      useValue: new DeterministicFakeCustodyTransferProvider(),
    },
    {
      provide: WithdrawalSubmissionBatchService,
      useFactory: (
        jobs: WithdrawalSubmissionJobRepository,
        custody: CustodyTransferProvider,
        configuration: WithdrawalConfiguration,
      ) =>
        new WithdrawalSubmissionBatchService(
          jobs,
          custody,
          configuration.submissionBatchSize,
          configuration.submissionLeaseSeconds,
        ),
      inject: [WithdrawalSubmissionJobRepository, CustodyTransferProvider, WithdrawalConfiguration],
    },
    WithdrawalSubmissionWorker,
    {
      provide: WithdrawalRecoveryBatchService,
      useFactory: (
        jobs: WithdrawalSubmissionJobRepository,
        custody: CustodyTransferProvider,
        configuration: WithdrawalConfiguration,
      ) => new WithdrawalRecoveryBatchService(jobs, custody, configuration.recoveryBatchSize),
      inject: [WithdrawalSubmissionJobRepository, CustodyTransferProvider, WithdrawalConfiguration],
    },
    WithdrawalRecoveryWorker,
  ],
})
export class WorkerModule {}
