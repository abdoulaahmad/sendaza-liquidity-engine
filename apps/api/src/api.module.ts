import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller';
import { RegistryController } from './registry.controller';
import { RegistryRepository, RegistryService } from '../../../packages/domain/src';
import { DatabaseModule, PrismaRegistryRepository } from '../../../packages/database/src';
import { CredentialSecretProvider } from '../../../packages/configuration/src';
import { AuthenticationGuard } from './authentication.guard';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, RegistryController],
  providers: [
    RegistryService,
    CredentialSecretProvider,
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: RegistryRepository, useExisting: PrismaRegistryRepository },
  ],
})
export class ApiModule {}
