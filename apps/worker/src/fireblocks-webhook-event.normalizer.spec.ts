import { FireblocksWebhookEventNormalizer } from './fireblocks-webhook-event.normalizer';

describe('FireblocksWebhookEventNormalizer', () => {
  const normalizer = new FireblocksWebhookEventNormalizer();

  it('normalizes provider status, hash, block and confirmation evidence', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        id: 'event-1',
        eventType: 'transaction.status.updated',
        createdAt: '2026-09-08T12:00:00.000Z',
        data: {
          id: 'transfer-1',
          status: 'CONFIRMING',
          txHash: '0xabc',
          numOfConfirmations: 3,
          blockInfo: { blockHeight: '9007199254740993', blockHash: '0xblock' },
        },
      }),
    );
    expect(
      normalizer.normalize({
        inboxId: 'inbox-1',
        providerEventId: 'event-1',
        rawBody,
        leaseToken: 'lease-1',
      }),
    ).toEqual({
      source: 'FIREBLOCKS_WEBHOOK',
      providerEventId: 'event-1',
      providerStatus: 'CONFIRMING',
      providerTransferId: 'transfer-1',
      txHash: '0xabc',
      blockHash: '0xblock',
      blockNumber: 9007199254740993n,
      confirmationCount: 3,
      observedAt: new Date('2026-09-08T12:00:00.000Z'),
    });
  });

  it('rejects a payload without a provider status', () => {
    expect(() =>
      normalizer.normalize({
        inboxId: 'inbox-1',
        providerEventId: 'event-1',
        rawBody: Buffer.from(JSON.stringify({ data: { id: 'transfer-1' } })),
        leaseToken: 'lease-1',
      }),
    ).toThrow('FIREBLOCKS_FINALITY_PAYLOAD_INVALID');
  });
});
