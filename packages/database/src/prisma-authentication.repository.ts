import { Injectable } from '@nestjs/common';
import {
  AuthenticatedRequestContext,
  AuthenticationNonceRepository,
  CredentialMetadata,
  CredentialMetadataRepository,
} from '../../domain/src';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaCredentialMetadataRepository implements CredentialMetadataRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByKeyId(keyId: string): Promise<CredentialMetadata | undefined> {
    const credential = await this.prisma.serviceCredential.findUnique({ where: { keyId } });
    if (!credential) return undefined;
    return {
      id: credential.id,
      keyId: credential.keyId,
      clientId: credential.clientId,
      status: credential.status,
      validFrom: credential.validFrom,
      ...(credential.validUntil ? { validUntil: credential.validUntil } : {}),
    };
  }
}

@Injectable()
export class PrismaAuthenticationNonceRepository implements AuthenticationNonceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claim(context: AuthenticatedRequestContext): Promise<boolean> {
    try {
      await this.prisma.authenticationNonce.create({
        data: {
          credentialId: context.credentialId,
          nonceHash: context.nonceHash,
          expiresAt: context.nonceExpiresAt,
        },
      });
      return true;
    } catch (error: unknown) {
      if (this.isUniqueConstraintError(error)) return false;
      throw error;
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}
