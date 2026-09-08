import { FireblocksWebhookConfiguration } from './fireblocks-webhook.configuration';

describe('FireblocksWebhookConfiguration', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('selects the sandbox-owned JWKS endpoint by default', () => {
    delete process.env.SLE_FIREBLOCKS_WEBHOOK_ENVIRONMENT;
    expect(new FireblocksWebhookConfiguration()).toMatchObject({
      environment: 'SANDBOX',
      jwksUrl: 'https://sandbox-keys.fireblocks.io/.well-known/jwks.json',
      maximumBodyBytes: 100000,
      jwksTimeoutMs: 5000,
      maximumJwksCacheSeconds: 3600,
    });
  });

  it('maps every supported workspace region to a fixed Fireblocks host', () => {
    const expected = {
      US: 'https://keys.fireblocks.io/.well-known/jwks.json',
      EU: 'https://eu-keys.fireblocks.io/.well-known/jwks.json',
      EU2: 'https://eu2-keys.fireblocks.io/.well-known/jwks.json',
      SANDBOX: 'https://sandbox-keys.fireblocks.io/.well-known/jwks.json',
    };
    for (const [environment, jwksUrl] of Object.entries(expected)) {
      process.env.SLE_FIREBLOCKS_WEBHOOK_ENVIRONMENT = environment;
      expect(new FireblocksWebhookConfiguration().jwksUrl).toBe(jwksUrl);
    }
  });

  it('rejects an unknown environment instead of accepting an arbitrary JWKS URL', () => {
    process.env.SLE_FIREBLOCKS_WEBHOOK_ENVIRONMENT = 'CUSTOM';
    expect(() => new FireblocksWebhookConfiguration()).toThrow(
      'SLE_FIREBLOCKS_WEBHOOK_ENVIRONMENT_INVALID',
    );
  });
});
