import { custodyWebhookPayloadSha256 } from '../../domain/src';
import { PrismaCustodyWebhookInboxRepository } from './prisma-custody-webhook-inbox.repository';
import { PrismaService } from './prisma.service';

describe('PrismaCustodyWebhookInboxRepository', () => {
  const attemptFindUnique = jest.fn();
  const inboxCreate = jest.fn();
  const inboxFindUniqueOrThrow = jest.fn();
  const prisma = {
    withdrawalTransactionAttempt: { findUnique: attemptFindUnique },
    custodyWebhookInbox: { create: inboxCreate, findUniqueOrThrow: inboxFindUniqueOrThrow },
  } as unknown as PrismaService;
  const repository = new PrismaCustodyWebhookInboxRepository(prisma);
  const webhook = {
    providerEventId: '123e4567-e89b-42d3-a456-426614174000',
    eventType: 'transaction.status.updated',
    providerTransferId: 'provider-transfer-1',
    rawBody: Buffer.from('{"event":"one"}'),
    signatureKeyId: 'key-1',
    receivedAt: new Date('2026-09-08T10:00:00.000Z'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('links a verified event to the withdrawal found by provider transfer id', async () => {
    attemptFindUnique.mockResolvedValue({ withdrawalId: 'withdrawal-1' });
    inboxCreate.mockResolvedValue({ id: 'inbox-1' });
    await expect(repository.persistVerified(webhook)).resolves.toEqual({
      kind: 'STORED',
      inboxId: 'inbox-1',
    });
    expect(inboxCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerEventId: webhook.providerEventId,
        withdrawalId: 'withdrawal-1',
        signatureAlgorithm: 'RS512',
        payloadSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
      select: { id: true },
    });
  });

  it('returns the existing inbox id for an exact duplicate event', async () => {
    attemptFindUnique.mockResolvedValue(null);
    inboxCreate.mockRejectedValue({ code: 'P2002' });
    inboxFindUniqueOrThrow.mockResolvedValue({
      id: 'inbox-1',
      payloadSha256: custodyWebhookPayloadSha256(webhook.rawBody),
    });
    const duplicate = { ...webhook, rawBody: Buffer.from('{"event":"one"}') };
    await expect(repository.persistVerified(duplicate)).resolves.toEqual({
      kind: 'DUPLICATE',
      inboxId: 'inbox-1',
    });
  });

  it('rejects reuse of a provider event id with different raw bytes', async () => {
    attemptFindUnique.mockResolvedValue(null);
    inboxCreate.mockRejectedValue({ code: 'P2002' });
    inboxFindUniqueOrThrow.mockResolvedValue({ id: 'inbox-1', payloadSha256: '0'.repeat(64) });
    await expect(repository.persistVerified(webhook)).rejects.toThrow(
      'FIREBLOCKS_WEBHOOK_EVENT_ID_CONFLICT',
    );
  });
});
