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

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, RegistryController, QuoteController],
  providers: [
    RegistryService,
    QuoteService,
    CredentialSecretProvider,
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: RegistryRepository, useExisting: PrismaRegistryRepository },
    { provide: QuoteRepository, useExisting: PrismaQuoteRepository },
  ],
})
export class ApiModule {}
