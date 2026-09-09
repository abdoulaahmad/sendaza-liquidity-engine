import { generateKeyPairSync, sign } from 'node:crypto';
import { FireblocksWebhookConfiguration } from '../../../packages/configuration/src';
import { CustodyWebhookError } from '../../../packages/domain/src';
import { FireblocksWebhookVerifier } from './fireblocks-webhook.verifier';

describe('FireblocksWebhookVerifier', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'fireblocks-test-key';
  const configuration = {
    jwksUrl: 'https://sandbox-keys.fireblocks.io/.well-known/jwks.json',
    jwksTimeoutMs: 1000,
    maximumJwksCacheSeconds: 3600,
  } as FireblocksWebhookConfiguration;
  const rawBody = Buffer.from(
    '{"id":"123e4567-e89b-42d3-a456-426614174000","eventType":"transaction.status.updated","data":{"id":"tx-1"}}',
  );

  function signature(body: Buffer, header: object = { alg: 'RS512', kid }): string {
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const signingInput = encodedHeader + '.' + body.toString('base64url');
    const encodedSignature = sign('RSA-SHA512', Buffer.from(signingInput), privateKey).toString(
      'base64url',
    );
    return encodedHeader + '..' + encodedSignature;
  }

  function fetcher(): jest.MockedFunction<typeof fetch> {
    return jest.fn(
      async () =>
        new Response(
          JSON.stringify({ keys: [{ ...jwk, kid, use: 'sig', alg: 'RS512', kty: 'RSA' }] }),
          { status: 200, headers: { 'cache-control': 'public, max-age=3600' } },
        ),
    ) as unknown as jest.MockedFunction<typeof fetch>;
  }

  it('verifies detached RS512 JWS over the exact raw body', async () => {
    const fetch = fetcher();
    const verifier = new FireblocksWebhookVerifier(configuration, fetch);
    await expect(verifier.verify(rawBody, signature(rawBody))).resolves.toEqual({ keyId: kid });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a signature when the body bytes change', async () => {
    const verifier = new FireblocksWebhookVerifier(configuration, fetcher());
    await expect(
      verifier.verify(Buffer.from(rawBody.toString() + ' '), signature(rawBody)),
    ).rejects.toEqual(new CustodyWebhookError('FIREBLOCKS_WEBHOOK_SIGNATURE_INVALID'));
  });

  it('rejects algorithm confusion before fetching a key', async () => {
    const fetch = fetcher();
    const verifier = new FireblocksWebhookVerifier(configuration, fetch);
    await expect(
      verifier.verify(rawBody, signature(rawBody, { alg: 'RS256', kid })),
    ).rejects.toEqual(new CustodyWebhookError('FIREBLOCKS_WEBHOOK_SIGNATURE_INVALID'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes once and then rejects an unknown key id', async () => {
    const fetch = fetcher();
    const verifier = new FireblocksWebhookVerifier(configuration, fetch);
    await expect(
      verifier.verify(rawBody, signature(rawBody, { alg: 'RS512', kid: 'unknown-key' })),
    ).rejects.toEqual(new CustodyWebhookError('FIREBLOCKS_WEBHOOK_SIGNING_KEY_UNKNOWN'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
