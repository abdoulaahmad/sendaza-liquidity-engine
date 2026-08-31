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
} from '../../domain/src';
import { PrismaIdempotencyRepository } from './prisma-idempotency.repository';

@Module({
  providers: [
    PrismaService,
    PrismaRegistryRepository,
    PrismaAuthenticationNonceRepository,
    PrismaCredentialMetadataRepository,
    PrismaIdempotencyRepository,
    { provide: AuthenticationNonceRepository, useExisting: PrismaAuthenticationNonceRepository },
    { provide: CredentialMetadataRepository, useExisting: PrismaCredentialMetadataRepository },
    { provide: IdempotencyRepository, useExisting: PrismaIdempotencyRepository },
  ],
  exports: [
    PrismaRegistryRepository,
    AuthenticationNonceRepository,
    CredentialMetadataRepository,
    IdempotencyRepository,
  ],
})
export class DatabaseModule {}
