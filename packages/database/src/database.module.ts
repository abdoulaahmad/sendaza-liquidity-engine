import { Module } from '@nestjs/common';
import { PrismaRegistryRepository } from './prisma-registry.repository';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService, PrismaRegistryRepository],
  exports: [PrismaRegistryRepository],
})
export class DatabaseModule {}
