import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CredentialSecretProvider } from '../../../packages/configuration/src';
import {
  AuthenticationNonceRepository,
  CredentialMetadataRepository,
  signRequest,
} from '../../../packages/domain/src';
import { AuthenticationGuard } from './authentication.guard';

describe('AuthenticationGuard', () => {
  const secret = 'sendaza-development-secret-at-least-32-bytes';
  const credential = {
    id: '00000000-0000-4000-8000-000000000001',
    keyId: 'sendaza-1',
    clientId: 'sendaza-core',
    status: 'ACTIVE' as const,
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
  };

  function setup(claim = true) {
    const credentials: CredentialMetadataRepository = {
      findByKeyId: jest.fn().mockResolvedValue(credential),
    };
    const nonces: AuthenticationNonceRepository = { claim: jest.fn().mockResolvedValue(claim) };
    const guard = new AuthenticationGuard(
      new Reflector(),
      new CredentialSecretProvider(JSON.stringify([{ keyId: credential.keyId, secret }])),
      credentials,
      nonces,
    );
    return { guard, credentials, nonces };
  }

  function signedContext(overrides: Record<string, string> = {}): ExecutionContext {
    const timestamp = new Date().toISOString();
    const request = {
      method: 'GET',
      originalUrl: '/api/v1/assets?enabled=true',
      rawBody: Buffer.alloc(0),
      headers: {} as Record<string, string>,
    };
    const nonce = 'unique_nonce_value_123456';
    const signature = signRequest(
      {
        method: request.method,
        rawTarget: request.originalUrl,
        timestamp,
        nonce,
        rawBody: request.rawBody,
      },
      secret,
    );
    request.headers = {
      'x-correlation-id': '00000000-0000-4000-8000-000000000002',
      'x-sle-key-id': credential.keyId,
      'x-sle-timestamp': timestamp,
      'x-sle-nonce': nonce,
      'x-sle-signature': signature,
      ...overrides,
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => signedContext,
      getClass: () => AuthenticationGuard,
    } as unknown as ExecutionContext;
  }

  it('authenticates and atomically claims a signed request nonce', async () => {
    const { guard, nonces } = setup();
    await expect(guard.canActivate(signedContext())).resolves.toBe(true);
    expect(nonces.claim).toHaveBeenCalledTimes(1);
  });

  it('rejects missing authentication before credential lookup', async () => {
    const { guard, credentials } = setup();
    const context = signedContext({ 'x-sle-signature': '' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { error: { code: 'AUTHENTICATION_REQUIRED' } },
    });
    expect(credentials.findByKeyId).not.toHaveBeenCalled();
  });

  it('rejects forged raw request targets', async () => {
    const { guard } = setup();
    const context = signedContext();
    const request = context.switchToHttp().getRequest<{ originalUrl: string }>();
    request.originalUrl = '/api/v1/assets?enabled=false';
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { error: { code: 'INVALID_SIGNATURE' } },
    });
  });

  it('rejects a replayed nonce with a conflict', async () => {
    const { guard } = setup(false);
    await expect(guard.canActivate(signedContext())).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'REQUEST_REPLAYED' } },
    });
  });

  it('rejects malformed correlation IDs', async () => {
    const { guard } = setup();
    const result = guard.canActivate(signedContext({ 'x-correlation-id': 'not-a-uuid' }));
    await expect(result).rejects.toBeInstanceOf(HttpException);
    await expect(result).rejects.toMatchObject({
      response: { error: { code: 'INVALID_CORRELATION_ID' } },
    });
  });
});
