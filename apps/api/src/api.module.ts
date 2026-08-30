import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RegistryController } from './registry.controller';
import { RegistryRepository, RegistryService } from '../../../packages/domain/src';
import { DatabaseModule, PrismaRegistryRepository } from '../../../packages/database/src';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, RegistryController],
  providers: [
    RegistryService,
    { provide: RegistryRepository, useExisting: PrismaRegistryRepository },
  ],
})
export class ApiModule {}
