import { Module } from '@nestjs/common';
import { RegistryRepository, SeededRegistryRepository } from './registry.repository';
import { RegistryService } from './registry.service';

@Module({
  providers: [RegistryService, { provide: RegistryRepository, useClass: SeededRegistryRepository }],
  exports: [RegistryService],
})
export class RegistryModule {}
