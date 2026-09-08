import {
  CustodyFinalityProvider,
  CustodyWebhookEventNormalizer,
  WithdrawalFinalityRepository,
  WithdrawalPollingFinalityBatchService,
  WithdrawalWebhookFinalityBatchService,
  withdrawalFinalityEvidenceHash,
} from './withdrawal-finality';

describe('withdrawal finality orchestration', () => {
  const now = new Date('2026-09-08T12:00:00.000Z');

  it('processes verified webhook claims through the shared repository boundary', async () => {
    const claim = {
      inboxId: 'inbox-1',
      providerEventId: 'event-1',
      rawBody: Buffer.from('{}'),
      leaseToken: 'lease-1',
    };
    const evidence = {
      source: 'FIREBLOCKS_WEBHOOK' as const,
      providerEventId: 'event-1',
      providerStatus: 'CONFIRMING',
      observedAt: now,
    };
    const repository = {
      claimWebhookBatch: jest.fn().mockResolvedValue([claim]),
      applyWebhookEvidence: jest.fn().mockResolvedValue({
        withdrawalId: 'withdrawal-1',
        previousStatus: 'SUBMITTED',
        status: 'CONFIRMING',
        duplicateEvidence: false,
      }),
      retryWebhook: jest.fn(),
    } as unknown as WithdrawalFinalityRepository;
    const normalizer = { normalize: jest.fn().mockReturnValue(evidence) };
    const service = new WithdrawalWebhookFinalityBatchService(
      repository,
      normalizer as CustodyWebhookEventNormalizer,
      10,
      30,
    );

    await expect(service.processBatch(now, 'lease-1')).resolves.toEqual({
      claimed: 1,
      processed: 1,
      retried: 0,
    });
    expect(repository.applyWebhookEvidence).toHaveBeenCalledWith(
      claim,
      evidence,
      expect.any(String),
      now,
    );
  });

  it('releases a malformed webhook claim for retry with a stable error code', async () => {
    const claim = {
      inboxId: 'inbox-1',
      providerEventId: 'event-1',
      rawBody: Buffer.from('{}'),
      leaseToken: 'lease-1',
    };
    const repository = {
      claimWebhookBatch: jest.fn().mockResolvedValue([claim]),
      applyWebhookEvidence: jest.fn(),
      retryWebhook: jest.fn(),
    } as unknown as WithdrawalFinalityRepository;
    const normalizer = {
      normalize: jest.fn(() => {
        throw new Error('FIREBLOCKS_FINALITY_PAYLOAD_INVALID');
      }),
    };
    const service = new WithdrawalWebhookFinalityBatchService(
      repository,
      normalizer as CustodyWebhookEventNormalizer,
      10,
      30,
    );

    await expect(service.processBatch(now, 'lease-1')).resolves.toEqual({
      claimed: 1,
      processed: 0,
      retried: 1,
    });
    expect(repository.retryWebhook).toHaveBeenCalledWith(
      claim,
      'FIREBLOCKS_FINALITY_PAYLOAD_INVALID',
      now,
    );
  });

  it('polls by provider transfer id without holding a repository transaction', async () => {
    const claim = {
      jobId: 'job-1',
      withdrawalId: 'withdrawal-1',
      providerTransferId: 'transfer-1',
      leaseToken: 'lease-1',
    };
    const evidence = {
      source: 'FIREBLOCKS_POLL' as const,
      providerStatus: 'COMPLETED',
      observedAt: now,
    };
    const repository = {
      claimPollingBatch: jest.fn().mockResolvedValue([claim]),
      applyPollingEvidence: jest.fn().mockResolvedValue({
        withdrawalId: 'withdrawal-1',
        previousStatus: 'CONFIRMING',
        status: 'CONFIRMING',
        duplicateEvidence: false,
      }),
      retryPolling: jest.fn(),
    } as unknown as WithdrawalFinalityRepository;
    const provider = { getTransfer: jest.fn().mockResolvedValue(evidence) };
    const service = new WithdrawalPollingFinalityBatchService(
      repository,
      provider as CustodyFinalityProvider,
      10,
      30,
      15,
    );

    await expect(service.processBatch(now, 'lease-1')).resolves.toEqual({
      claimed: 1,
      observed: 1,
      retried: 0,
    });
    expect(provider.getTransfer).toHaveBeenCalledWith('transfer-1');
    expect(repository.applyPollingEvidence).toHaveBeenCalledWith(
      claim,
      evidence,
      expect.any(String),
      now,
      new Date('2026-09-08T12:00:15.000Z'),
    );
  });

  it('hashes bigint evidence deterministically without numeric coercion', () => {
    const evidence = {
      source: 'CHAIN_RPC' as const,
      txHash: '0xabc',
      blockNumber: 9007199254740993n,
      confirmationCount: 12,
      executionSucceeded: true,
      observedAt: now,
    };
    expect(withdrawalFinalityEvidenceHash(evidence)).toMatch(/^[0-9a-f]{64}$/);
    expect(withdrawalFinalityEvidenceHash(evidence)).toBe(
      withdrawalFinalityEvidenceHash({ ...evidence }),
    );
  });
});
