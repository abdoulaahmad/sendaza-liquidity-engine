import { Module } from '@nestjs/common';
import { PrismaRegistryRepository } from './prisma-registry.repository';
import { PrismaService } from './prisma.service';
import {
  PrismaAuthenticationNonceRepository,
  PrismaCredentialMetadataRepository,
} from './prisma-authentication.repository';
import {
  AuthenticationNonceRepository,
  CredentialMetadataRepository,
  IdempotencyRepository,
  AuditRepository,
  OutboxRepository,
  PricingRepository,
  PricingRefreshJobRepository,
  QuoteRepository,
  TreasuryRepository,
  TreasurySyncJobRepository,
  PurchaseRepository,
  PurchaseTimeoutRepository,
  NetworkFeeRepository,
  NetworkFeeRefreshJobRepository,
  WithdrawalRepository,
  WithdrawalSubmissionJobRepository,
} from '../../domain/src';
import { PrismaIdempotencyRepository } from './prisma-idempotency.repository';
import { PrismaAuditRepository } from './prisma-audit.repository';
import { PrismaOutboxRepository } from './prisma-outbox.repository';
import { PrismaPricingRepository } from './prisma-pricing.repository';
import { PrismaPricingRefreshJobRepository } from './prisma-pricing-refresh-job.repository';
import { PrismaQuoteRepository } from './prisma-quote.repository';
import {
  PrismaTreasuryRepository,
  PrismaTreasurySyncJobRepository,
} from './prisma-treasury.repository';
import {
  PrismaPurchaseRepository,
  PrismaPurchaseTimeoutRepository,
} from './prisma-purchase.repository';
import { PrismaNetworkFeeRepository } from './prisma-network-fee.repository';
import { PrismaNetworkFeeRefreshJobRepository } from './prisma-network-fee-refresh-job.repository';
import {
  PrismaWithdrawalRepository,
  PrismaWithdrawalSubmissionJobRepository,
} from './prisma-withdrawal.repository';

@Module({
  providers: [
    PrismaService,
    PrismaRegistryRepository,
    PrismaAuthenticationNonceRepository,
    PrismaCredentialMetadataRepository,
    PrismaIdempotencyRepository,
    PrismaAuditRepository,
    PrismaOutboxRepository,
    PrismaPricingRepository,
    PrismaPricingRefreshJobRepository,
    PrismaQuoteRepository,
    PrismaTreasuryRepository,
    PrismaTreasurySyncJobRepository,
    PrismaPurchaseRepository,
    PrismaPurchaseTimeoutRepository,
    PrismaNetworkFeeRepository,
    PrismaNetworkFeeRefreshJobRepository,
    PrismaWithdrawalRepository,
    PrismaWithdrawalSubmissionJobRepository,
    { provide: AuthenticationNonceRepository, useExisting: PrismaAuthenticationNonceRepository },
    { provide: CredentialMetadataRepository, useExisting: PrismaCredentialMetadataRepository },
    { provide: IdempotencyRepository, useExisting: PrismaIdempotencyRepository },
    { provide: AuditRepository, useExisting: PrismaAuditRepository },
    { provide: OutboxRepository, useExisting: PrismaOutboxRepository },
    { provide: PricingRepository, useExisting: PrismaPricingRepository },
    { provide: QuoteRepository, useExisting: PrismaQuoteRepository },
    { provide: TreasuryRepository, useExisting: PrismaTreasuryRepository },
    { provide: TreasurySyncJobRepository, useExisting: PrismaTreasurySyncJobRepository },
    { provide: PurchaseRepository, useExisting: PrismaPurchaseRepository },
    { provide: PurchaseTimeoutRepository, useExisting: PrismaPurchaseTimeoutRepository },
    { provide: NetworkFeeRepository, useExisting: PrismaNetworkFeeRepository },
    {
      provide: NetworkFeeRefreshJobRepository,
      useExisting: PrismaNetworkFeeRefreshJobRepository,
    },
    { provide: WithdrawalRepository, useExisting: PrismaWithdrawalRepository },
    {
      provide: WithdrawalSubmissionJobRepository,
      useExisting: PrismaWithdrawalSubmissionJobRepository,
    },
    {
      provide: PricingRefreshJobRepository,
      useExisting: PrismaPricingRefreshJobRepository,
    },
  ],
  exports: [
    PrismaRegistryRepository,
    AuthenticationNonceRepository,
    CredentialMetadataRepository,
    IdempotencyRepository,
    AuditRepository,
    OutboxRepository,
    PricingRepository,
    PricingRefreshJobRepository,
    QuoteRepository,
    TreasuryRepository,
    TreasurySyncJobRepository,
    PurchaseRepository,
    PurchaseTimeoutRepository,
    NetworkFeeRepository,
    NetworkFeeRefreshJobRepository,
    WithdrawalRepository,
    WithdrawalSubmissionJobRepository,
  ],
})
export class DatabaseModule {}
