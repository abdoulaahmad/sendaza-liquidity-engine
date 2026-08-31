import { createIdempotencyIdentity, validateIdempotencyKey } from './idempotency';

describe('idempotency identity', () => {
  const request = {
    clientId: 'sendaza-core',
    operation: 'purchases.create',
    key: 'purchase-2026-0001',
    method: 'post',
    rawTarget: '/api/v1/purchases',
    rawBody: Buffer.from('{quoteId:quote-1}'),
    correlationId: '00000000-0000-4000-8000-000000000001',
  };

  it('creates a stable hash without exposing the raw body', () => {
    const first = createIdempotencyIdentity(request);
    const second = createIdempotencyIdentity({ ...request, method: 'POST' });
    expect(first.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.requestHash).toBe(second.requestHash);
    expect(first).not.toHaveProperty('rawBody');
  });

  it.each(['clientId', 'operation', 'method', 'rawTarget', 'rawBody'] as const)(
    'binds the hash to %s',
    (field) => {
      const changed = {
        ...request,
        [field]: field === 'rawBody' ? Buffer.from('{}') : `${request[field]}-changed`,
      };
      expect(createIdempotencyIdentity(changed).requestHash).not.toBe(
        createIdempotencyIdentity(request).requestHash,
      );
    },
  );

  it('validates visible, bounded idempotency keys', () => {
    expect(validateIdempotencyKey('purchase:core/2026-1')).toBe(true);
    expect(validateIdempotencyKey('')).toBe(false);
    expect(validateIdempotencyKey('contains a space')).toBe(false);
    expect(validateIdempotencyKey('a'.repeat(201))).toBe(false);
  });
});
