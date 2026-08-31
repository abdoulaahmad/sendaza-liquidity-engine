import {
  AuthenticationError,
  canonicalizeSignedRequest,
  HmacAuthenticator,
  HmacCredential,
  signRequest,
} from './authentication';

const now = new Date('2026-08-30T12:00:00.000Z');
const credential: HmacCredential = {
  id: 'credential-one',
  keyId: 'sendaza-key-2026-08',
  clientId: 'sendaza-core',
  secret: 'test-secret-with-sufficient-entropy',
  status: 'ACTIVE',
  validFrom: new Date('2026-08-01T00:00:00.000Z'),
};

const unsignedRequest = {
  method: 'post',
  rawTarget: '/api/v1/purchases?mode=standard',
  timestamp: now.toISOString(),
  nonce: 'nonce_1234567890abcdef',
  rawBody: Buffer.from('{"amount":"1000.00"}', 'utf8'),
};

const signedRequest = () => ({
  ...unsignedRequest,
  signature: signRequest(unsignedRequest, credential.secret),
});

describe('HMAC authentication', () => {
  it('canonicalizes the exact request and raw body hash', () => {
    expect(canonicalizeSignedRequest(signedRequest())).toBe(
      [
        'POST',
        '/api/v1/purchases?mode=standard',
        now.toISOString(),
        'nonce_1234567890abcdef',
        '118a8822e3022e47ab4fff611d6382f5f607e1abbe99a3f91bd4b5f03a93d148',
      ].join('\n'),
    );
  });

  it('authenticates without returning the secret', () => {
    const context = new HmacAuthenticator().authenticate(signedRequest(), credential, now);
    expect(context).toMatchObject({ credentialId: 'credential-one', clientId: 'sendaza-core' });
    expect(context).not.toHaveProperty('secret');
  });

  it('rejects a forged body under the original signature', () => {
    const forged = {
      ...signedRequest(),
      rawBody: Buffer.from('{"amount":"9000.00"}', 'utf8'),
    };
    expect(() => new HmacAuthenticator().authenticate(forged, credential, now)).toThrow(
      new AuthenticationError('INVALID_SIGNATURE'),
    );
  });

  it('rejects stale requests', () => {
    const later = new Date('2026-08-30T12:05:00.001Z');
    expect(() => new HmacAuthenticator().authenticate(signedRequest(), credential, later)).toThrow(
      new AuthenticationError('STALE_REQUEST'),
    );
  });

  it('rejects a revoked key while a rotated key remains usable', () => {
    const revoked = { ...credential, status: 'REVOKED' as const };
    expect(() => new HmacAuthenticator().authenticate(signedRequest(), revoked, now)).toThrow(
      new AuthenticationError('INVALID_CREDENTIAL'),
    );

    const rotated = { ...credential, id: 'credential-two', keyId: 'new-key' };
    const rotatedRequest = {
      ...unsignedRequest,
      signature: signRequest(unsignedRequest, rotated.secret),
    };
    expect(new HmacAuthenticator().authenticate(rotatedRequest, rotated, now).credentialId).toBe(
      'credential-two',
    );
  });
});
