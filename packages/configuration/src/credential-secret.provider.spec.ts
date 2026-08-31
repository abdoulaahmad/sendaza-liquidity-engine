import { CredentialSecretProvider } from './credential-secret.provider';

describe('CredentialSecretProvider', () => {
  const secret = 'a-secret-with-at-least-thirty-two-bytes';

  it('loads one or two secrets by key ID', () => {
    const provider = new CredentialSecretProvider(
      JSON.stringify([
        { keyId: 'sendaza-current', secret },
        { keyId: 'sendaza-next', secret: `${secret}-next` },
      ]),
    );
    expect(provider.get('sendaza-current')).toBe(secret);
    expect(provider.get('missing')).toBeUndefined();
  });

  it.each([
    undefined,
    'not-json',
    '[]',
    JSON.stringify([{ keyId: 'bad key', secret }]),
    JSON.stringify([{ keyId: 'sendaza', secret: 'short' }]),
    JSON.stringify([
      { keyId: 'duplicate', secret },
      { keyId: 'duplicate', secret },
    ]),
  ])('fails closed for invalid configuration', (value) => {
    expect(() => new CredentialSecretProvider(value)).toThrow();
  });
});
