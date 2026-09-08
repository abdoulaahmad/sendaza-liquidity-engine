import {
  CustodyWebhookError,
  CustodyWebhookInboxRepository,
  CustodyWebhookIngestionService,
  CustodyWebhookSignatureVerifier,
} from './withdrawal-webhook';

describe('CustodyWebhookIngestionService', () => {
  const now = new Date('2026-09-08T10:00:00.000Z');
  const rawBody = Buffer.from(
    '{"id":"123e4567-e89b-42d3-a456-426614174000","eventType":"transaction.status.updated","data":{"id":"provider-transfer-1"}}',
  );
  const verify = jest.fn().mockResolvedValue({ keyId: 'key-1' });
  const persistVerified = jest.fn().mockResolvedValue({ kind: 'STORED', inboxId: 'inbox-1' });
  const verifier: CustodyWebhookSignatureVerifier = { verify };
  const inbox: CustodyWebhookInboxRepository = { persistVerified };
  const service = new CustodyWebhookIngestionService(verifier, inbox, 1024, () => now);

  beforeEach(() => jest.clearAllMocks());

  it('verifies raw bytes before persisting parsed event metadata', async () => {
    await expect(
      service.ingest({ rawBody, signature: 'header..signature', contentType: 'application/json' }),
    ).resolves.toEqual({ kind: 'STORED', inboxId: 'inbox-1' });
    expect(verify).toHaveBeenCalledWith(rawBody, 'header..signature');
    expect(persistVerified).toHaveBeenCalledWith({
      providerEventId: '123e4567-e89b-42d3-a456-426614174000',
      eventType: 'transaction.status.updated',
      providerTransferId: 'provider-transfer-1',
      rawBody,
      signatureKeyId: 'key-1',
      receivedAt: now,
    });
  });

  it('does not verify or persist an oversized body', async () => {
    await expect(
      service.ingest({
        rawBody: Buffer.alloc(1025),
        signature: 'header..signature',
        contentType: 'application/json',
      }),
    ).rejects.toEqual(new CustodyWebhookError('FIREBLOCKS_WEBHOOK_BODY_SIZE_INVALID'));
    expect(verify).not.toHaveBeenCalled();
    expect(persistVerified).not.toHaveBeenCalled();
  });

  it('does not persist invalid JSON even after its signature is valid', async () => {
    await expect(
      service.ingest({
        rawBody: Buffer.from('{'),
        signature: 'header..signature',
        contentType: 'application/json',
      }),
    ).rejects.toEqual(new CustodyWebhookError('FIREBLOCKS_WEBHOOK_JSON_INVALID'));
    expect(persistVerified).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON content type before verification', async () => {
    await expect(
      service.ingest({ rawBody, signature: 'header..signature', contentType: 'text/plain' }),
    ).rejects.toEqual(new CustodyWebhookError('FIREBLOCKS_WEBHOOK_CONTENT_TYPE_INVALID'));
    expect(verify).not.toHaveBeenCalled();
  });
});
