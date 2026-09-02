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
} from '../../domain/src';
import { PrismaIdempotencyRepository } from './prisma-idempotency.repository';
import { PrismaAuditRepository } from './prisma-audit.repository';
import { PrismaOutboxRepository } from './prisma-outbox.repository';
import { PrismaPricingRepository } from './prisma-pricing.repository';
import { PrismaPricingRefreshJobRepository } from './prisma-pricing-refresh-job.repository';
import { PrismaQuoteRepository } from './prisma-quote.repository';

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
    { provide: AuthenticationNonceRepository, useExisting: PrismaAuthenticationNonceRepository },
    { provide: CredentialMetadataRepository, useExisting: PrismaCredentialMetadataRepository },
    { provide: IdempotencyRepository, useExisting: PrismaIdempotencyRepository },
    { provide: AuditRepository, useExisting: PrismaAuditRepository },
    { provide: OutboxRepository, useExisting: PrismaOutboxRepository },
    { provide: PricingRepository, useExisting: PrismaPricingRepository },
    { provide: QuoteRepository, useExisting: PrismaQuoteRepository },
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
  ],
})
export class DatabaseModule {}
