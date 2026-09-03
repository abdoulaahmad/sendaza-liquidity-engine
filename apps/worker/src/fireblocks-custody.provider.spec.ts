import { generateKeyPairSync, verify } from 'node:crypto';
import { TreasurySyncTarget } from '../../../packages/domain/src';
import { FireblocksCustodyProvider, FireblocksProviderError } from './fireblocks-custody.provider';

describe('FireblocksCustodyProvider', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const target = {
    providerVaultId: '7',
    providerAssetId: 'ETH_TEST6',
  } as TreasurySyncTarget;
  const at = new Date('2026-09-02T12:00:00.000Z');

  it('signs exact request URIs and maps decimal-string wallet evidence', async () => {
    const fetcher = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get('Authorization')!;
      const token = authorization.replace('Bearer ', '');
      const [header, payload, signature] = token.split('.') as [string, string, string];
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
        string,
        unknown
      >;
      expect(claims.uri).toBe(new URL(url).pathname + new URL(url).search);
      expect(claims.sub).toBe('api-key');
      expect(claims.exp).toBe((claims.iat as number) + 29);
      expect(
        verify(
          'RSA-SHA256',
          Buffer.from(`${header}.${payload}`),
          publicKey,
          Buffer.from(signature, 'base64url'),
        ),
      ).toBe(true);
      expect(new Headers(init?.headers).get('X-API-Key')).toBe('api-key');
      if (url.includes('addresses_paginated')) {
        return new Response(JSON.stringify({ addresses: [{ address: '0xabc' }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          total: '2.0',
          available: '1.8',
          pending: '0.1',
          frozen: '0',
          lockedAmount: '0.1',
          blockHash: 'block-1',
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new FireblocksCustodyProvider(
      'api-key',
      privatePem,
      'https://sandbox-api.fireblocks.io',
      fetcher,
      1000,
      () => at,
    );

    await expect(provider.getWalletBalance(target)).resolves.toEqual({
      total: '2.0',
      available: '1.8',
      pending: '0.1',
      frozen: '0',
      locked: '0.1',
      addresses: [{ address: '0xabc' }],
      observedAt: at,
      providerReference: 'block-1',
    });
  });

  it('maps authentication rejection without including provider payloads', async () => {
    const provider = new FireblocksCustodyProvider(
      'api-key',
      privatePem,
      'https://sandbox-api.fireblocks.io',
      jest.fn().mockResolvedValue(new Response('secret provider detail', { status: 401 })),
    );
    await expect(provider.getWalletBalance(target)).rejects.toEqual(
      new FireblocksProviderError('CUSTODY_CREDENTIALS_INVALID'),
    );
  });

  it('refuses to initialize without API authentication credentials', () => {
    expect(
      () => new FireblocksCustodyProvider('', '', 'https://sandbox-api.fireblocks.io'),
    ).toThrow('CUSTODY_CREDENTIALS_MISSING');
  });
});
