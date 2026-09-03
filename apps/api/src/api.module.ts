import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller';
import { RegistryController } from './registry.controller';
import { RegistryRepository, RegistryService } from '../../../packages/domain/src';
import { DatabaseModule, PrismaRegistryRepository } from '../../../packages/database/src';
import { CredentialSecretProvider } from '../../../packages/configuration/src';
import { AuthenticationGuard } from './authentication.guard';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { AuditInterceptor } from './audit.interceptor';
import { QuoteController } from './quote.controller';
import { QuoteRepository, QuoteService } from '../../../packages/domain/src';
import { PrismaQuoteRepository } from '../../../packages/database/src';
import { PurchaseRepository, PurchaseService } from '../../../packages/domain/src';
import { PurchaseConfiguration } from '../../../packages/configuration/src';
import { PrismaPurchaseRepository } from '../../../packages/database/src';
import { PurchaseController } from './purchase.controller';
import { NetworkFeeRepository, WithdrawalFeeQuoteService } from '../../../packages/domain/src';
import { PrismaNetworkFeeRepository } from '../../../packages/database/src';
import { WithdrawalFeeQuoteController } from './withdrawal-fee-quote.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [
    HealthController,
    RegistryController,
    QuoteController,
    PurchaseController,
    WithdrawalFeeQuoteController,
  ],
  providers: [
    RegistryService,
    QuoteService,
    PurchaseConfiguration,
    WithdrawalFeeQuoteService,
    {
      provide: PurchaseService,
      useFactory: (repository: PurchaseRepository, configuration: PurchaseConfiguration) =>
        new PurchaseService(repository, configuration.reservationTtlSeconds),
      inject: [PurchaseRepository, PurchaseConfiguration],
    },
    CredentialSecretProvider,
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: RegistryRepository, useExisting: PrismaRegistryRepository },
    { provide: QuoteRepository, useExisting: PrismaQuoteRepository },
    { provide: PurchaseRepository, useExisting: PrismaPurchaseRepository },
    { provide: NetworkFeeRepository, useExisting: PrismaNetworkFeeRepository },
  ],
})
export class ApiModule {}
