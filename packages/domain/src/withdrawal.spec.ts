import {
  CustodyTransferProvider,
  StoredWithdrawal,
  WithdrawalError,
  WithdrawalRecoveryBatchService,
  WithdrawalRepository,
  WithdrawalService,
  WithdrawalSubmissionBatchService,
  WithdrawalSubmissionJobRepository,
} from './withdrawal';

describe('WithdrawalService', () => {
  const now = new Date('2026-09-03T15:00:00.000Z');
  const stored: StoredWithdrawal = {
    id: 'withdrawal-1',
    feeQuoteId: 'fee-quote-1',
    assetNetworkId: 'asset-network-1',
    customerReference: 'customer-1',
    clientLockReference: 'lock-1',
    clientReference: 'withdrawal-ref-1',
    destinationAddress: '0x1111111111111111111111111111111111111111',
    principalAtomic: 25_000_000n,
    totalDebitAtomic: 25_560_000n,
    assetDecimals: 6,
    externalTxId: 'withdrawal-1',
    status: 'CREATED',
    createdAt: now,
  };
  const create = jest.fn();
  const cancel = jest.fn();
  const findById = jest.fn();
  const repository: WithdrawalRepository = { create, cancel, findById };
  const service = new WithdrawalService(repository, () => now);

  beforeEach(() => jest.clearAllMocks());

  it('creates a decimal-string view using repository-controlled evidence', async () => {
    create.mockResolvedValue({ kind: 'SUCCESS', value: stored });
    await expect(
      service.create({
        feeQuoteId: 'fee-quote-1',
        customerReference: 'customer-1',
        clientLockReference: 'lock-1',
        clientReference: 'withdrawal-ref-1',
        destinationAddress: '0x1111111111111111111111111111111111111111',
        correlationId: 'correlation-1',
      }),
    ).resolves.toMatchObject({
      withdrawalId: 'withdrawal-1',
      status: 'CREATED',
      principal: '25.000000',
      totalDebit: '25.560000',
    });
  });

  it('preserves stable repository rejection codes on create', async () => {
    create.mockResolvedValue({ kind: 'FAILURE', code: 'FEE_QUOTE_EXPIRED' });
    await expect(
      service.create({
        feeQuoteId: 'fee-quote-1',
        customerReference: 'customer-1',
        clientLockReference: 'lock-1',
        clientReference: 'withdrawal-ref-1',
        destinationAddress: '0x1111111111111111111111111111111111111111',
        correlationId: 'correlation-1',
      }),
    ).rejects.toEqual(new WithdrawalError('FEE_QUOTE_EXPIRED'));
  });

  it('rejects cancellation once the submission job is claimed', async () => {
    cancel.mockResolvedValue({ kind: 'FAILURE', code: 'WITHDRAWAL_ALREADY_CLAIMED' });
    await expect(
      service.cancel({ withdrawalId: 'withdrawal-1', correlationId: 'correlation-1' }),
    ).rejects.toEqual(new WithdrawalError('WITHDRAWAL_ALREADY_CLAIMED'));
  });

  it('returns the authoritative withdrawal state', async () => {
    findById.mockResolvedValue({ ...stored, status: 'SUBMITTED', submittedAt: now });
    await expect(service.get('withdrawal-1')).resolves.toMatchObject({
      status: 'SUBMITTED',
      submittedAt: now.toISOString(),
    });
  });

  it('raises a stable not-found code', async () => {
    findById.mockResolvedValue(null);
    await expect(service.get('missing')).rejects.toEqual(
      new WithdrawalError('WITHDRAWAL_NOT_FOUND'),
    );
  });
});

describe('WithdrawalSubmissionBatchService', () => {
  const now = new Date('2026-09-03T15:00:00.000Z');
  const context = {
    withdrawalId: 'withdrawal-1',
    externalTxId: 'withdrawal-1',
    operation: 'CREATE' as const,
    providerVaultId: 'vault-1',
    providerAssetId: 'ETH_TEST6',
    destinationAddress: '0xabc',
    principalAtomic: 1_000n,
    assetDecimals: 6,
  };
  const claimBatch = jest.fn();
  const beginSubmitting = jest.fn();
  const recordOutcome = jest.fn();
  const jobs: WithdrawalSubmissionJobRepository = {
    claimBatch,
    beginSubmitting,
    recordOutcome,
  };
  const createTransfer = jest.fn();
  const findTransferByExternalTxId = jest.fn();
  const custody: CustodyTransferProvider = { createTransfer, findTransferByExternalTxId };
  const service = new WithdrawalSubmissionBatchService(jobs, custody, 10, 30);

  beforeEach(() => jest.clearAllMocks());

  it('never leaves a job unclaimed and never calls Fireblocks with an open job claim skipped', async () => {
    claimBatch.mockResolvedValue([
      { jobId: 'job-1', withdrawalId: 'withdrawal-1', leaseToken: 'lease-1' },
    ]);
    beginSubmitting.mockResolvedValue(context);
    createTransfer.mockResolvedValue({ kind: 'ACCEPTED', providerTransferId: 'ftx-1' });

    const result = await service.processBatch(now, 'lease-token-1');

    expect(result).toEqual({ claimed: 1, submitted: 1, failed: 0, unknown: 0 });
    expect(createTransfer).toHaveBeenCalledWith({
      externalTxId: 'withdrawal-1',
      providerVaultId: 'vault-1',
      providerAssetId: 'ETH_TEST6',
      destinationAddress: '0xabc',
      amountAtomic: 1_000n,
      assetDecimals: 6,
    });
    expect(recordOutcome).toHaveBeenCalledWith(
      { jobId: 'job-1', withdrawalId: 'withdrawal-1', leaseToken: 'lease-1' },
      { kind: 'SUBMITTED', providerTransferId: 'ftx-1' },
      expect.any(String),
      now,
    );
  });

  it('routes a provider terminal failure to reconciliation', async () => {
    claimBatch.mockResolvedValue([
      { jobId: 'job-1', withdrawalId: 'withdrawal-1', leaseToken: 'lease-1' },
    ]);
    beginSubmitting.mockResolvedValue(context);
    createTransfer.mockResolvedValue({ kind: 'TERMINAL_FAILURE', reasonCode: 'FAILED' });

    const result = await service.processBatch(now, 'lease-token-1');

    expect(result).toEqual({ claimed: 1, submitted: 0, failed: 1, unknown: 0 });
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'RECONCILIATION_REQUIRED' },
      expect.any(String),
      now,
    );
  });

  it('records SUBMISSION_UNKNOWN on an ambiguous provider response rather than assuming failure', async () => {
    claimBatch.mockResolvedValue([
      { jobId: 'job-1', withdrawalId: 'withdrawal-1', leaseToken: 'lease-1' },
    ]);
    beginSubmitting.mockResolvedValue(context);
    createTransfer.mockResolvedValue({ kind: 'UNKNOWN' });

    const result = await service.processBatch(now, 'lease-token-1');

    expect(result).toEqual({ claimed: 1, submitted: 0, failed: 0, unknown: 1 });
    expect(recordOutcome).toHaveBeenCalledWith(
      expect.anything(),
      { kind: 'SUBMISSION_UNKNOWN' },
      expect.any(String),
      now,
    );
  });

  it('never calls Fireblocks when a job cannot begin submitting (already cancelled or claimed)', async () => {
    claimBatch.mockResolvedValue([
      { jobId: 'job-1', withdrawalId: 'withdrawal-1', leaseToken: 'lease-1' },
    ]);
    beginSubmitting.mockResolvedValue(null);

    const result = await service.processBatch(now, 'lease-token-1');

    expect(result).toEqual({ claimed: 1, submitted: 0, failed: 0, unknown: 0 });
    expect(createTransfer).not.toHaveBeenCalled();
    expect(recordOutcome).not.toHaveBeenCalled();
  });
});

describe('WithdrawalRecoveryBatchService', () => {
  const now = new Date('2026-09-03T15:05:00.000Z');
  const claim = { jobId: 'job-1', withdrawalId: 'withdrawal-1', leaseToken: 'lease-1' };
  const context = {
    operation: 'LOOKUP' as const,
    withdrawalId: 'withdrawal-1',
    externalTxId: 'withdrawal-1',
    providerVaultId: 'vault-1',
    providerAssetId: 'ETH_TEST6',
    destinationAddress: '0xabc',
    principalAtomic: 1_000n,
    assetDecimals: 6,
  };
  const claimBatch = jest.fn();
  const beginSubmitting = jest.fn();
  const recordOutcome = jest.fn();
  const jobs: WithdrawalSubmissionJobRepository = {
    claimBatch,
    beginSubmitting,
    recordOutcome,
  };
  const findTransferByExternalTxId = jest.fn();
  const custody: CustodyTransferProvider = {
    createTransfer: jest.fn(),
    findTransferByExternalTxId,
  };
  const service = new WithdrawalRecoveryBatchService(jobs, custody, 10, 30);

  beforeEach(() => jest.clearAllMocks());

  it('claims recovery work and resolves by externalTxId', async () => {
    claimBatch.mockResolvedValue([claim]);
    beginSubmitting.mockResolvedValue(context);
    findTransferByExternalTxId.mockResolvedValue({
      kind: 'ACCEPTED',
      providerTransferId: 'ftx-1',
    });

    const result = await service.processBatch(now);

    expect(findTransferByExternalTxId).toHaveBeenCalledWith('withdrawal-1');
    expect(recordOutcome).toHaveBeenCalledWith(
      claim,
      { kind: 'SUBMITTED', providerTransferId: 'ftx-1' },
      expect.any(String),
      now,
    );
    expect(result).toEqual({
      checked: 1,
      resolvedSubmitted: 1,
      resolvedFailed: 0,
      stillUnknown: 0,
    });
  });

  it('keeps an ambiguous lookup leased through the repository reschedule path', async () => {
    claimBatch.mockResolvedValue([claim]);
    beginSubmitting.mockResolvedValue(context);
    findTransferByExternalTxId.mockResolvedValue({ kind: 'UNKNOWN' });

    const result = await service.processBatch(now);

    expect(recordOutcome).toHaveBeenCalledWith(
      claim,
      { kind: 'SUBMISSION_UNKNOWN' },
      expect.any(String),
      now,
    );
    expect(result.stillUnknown).toBe(1);
  });
});
