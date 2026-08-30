import { AuthenticatedRequestContext } from '../../domain/src';
import {
  PrismaAuthenticationNonceRepository,
  PrismaCredentialMetadataRepository,
} from './prisma-authentication.repository';
import { PrismaService } from './prisma.service';

describe('Prisma authentication repositories', () => {
  const credentialFindUnique = jest.fn();
  const nonceCreate = jest.fn();
  const prisma = {
    serviceCredential: { findUnique: credentialFindUnique },
    authenticationNonce: { create: nonceCreate },
  } as unknown as PrismaService;
  const credentials = new PrismaCredentialMetadataRepository(prisma);
  const nonces = new PrismaAuthenticationNonceRepository(prisma);
  const context: AuthenticatedRequestContext = {
    credentialId: '00000000-0000-4000-8000-000000000001',
    credentialKeyId: 'sendaza-1',
    clientId: 'sendaza-core',
    nonceHash: 'a'.repeat(64),
    nonceExpiresAt: new Date('2026-08-30T12:05:00.000Z'),
  };

  beforeEach(() => jest.resetAllMocks());

  it('returns non-secret credential metadata', async () => {
    credentialFindUnique.mockResolvedValue({
      id: context.credentialId,
      keyId: context.credentialKeyId,
      clientId: context.clientId,
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: null,
    });
    await expect(credentials.findByKeyId(context.credentialKeyId)).resolves.toEqual({
      id: context.credentialId,
      keyId: context.credentialKeyId,
      clientId: context.clientId,
      status: 'ACTIVE',
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('claims a nonce once', async () => {
    nonceCreate.mockResolvedValue({ id: 'nonce-id' });
    await expect(nonces.claim(context)).resolves.toBe(true);
    expect(nonceCreate).toHaveBeenCalledWith({
      data: {
        credentialId: context.credentialId,
        nonceHash: context.nonceHash,
        expiresAt: context.nonceExpiresAt,
      },
    });
  });

  it('maps the PostgreSQL unique constraint to a replay result', async () => {
    nonceCreate.mockRejectedValue({ code: 'P2002' });
    await expect(nonces.claim(context)).resolves.toBe(false);
  });

  it('does not hide infrastructure failures', async () => {
    nonceCreate.mockRejectedValue(new Error('database unavailable'));
    await expect(nonces.claim(context)).rejects.toThrow('database unavailable');
  });
});
