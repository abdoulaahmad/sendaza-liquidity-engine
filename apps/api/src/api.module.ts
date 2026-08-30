import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RegistryController } from './registry.controller';
import { RegistryModule } from '../../../packages/domain/src';

@Module({
  imports: [RegistryModule],
  controllers: [HealthController, RegistryController],
})
export class ApiModule {}
