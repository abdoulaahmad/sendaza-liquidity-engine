import { randomUUID } from 'node:crypto';
import {
  PrismaWithdrawalRepository,
  PrismaWithdrawalSubmissionJobRepository,
} from './prisma-withdrawal.repository';
import { PrismaService } from './prisma.service';

describe('withdrawal PostgreSQL integration', () => {
  const prisma = new PrismaService();
  const secondPrisma = new PrismaService();
  const withdrawals = new PrismaWithdrawalRepository(prisma);
  const jobs = new PrismaWithdrawalSubmissionJobRepository(prisma);
  const secondJobs = new PrismaWithdrawalSubmissionJobRepository(secondPrisma);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const ids = {
    nativeAsset: randomUUID(),
    tokenAsset: randomUUID(),
    network: randomUUID(),
    assetNetwork: randomUUID(),
    feePolicy: randomUUID(),
    withdrawalPolicy: randomUUID(),
    feeSnapshot: randomUUID(),
  };
  let configurationVersionId: number;

  async function createFeeQuote(
    overrides: {
      destinationAddress?: string;
      expiresAt?: Date;
      principalAtomic?: bigint;
    } = {},
  ) {
    return prisma.withdrawalFeeQuote.create({
      data: {
        assetNetworkId: ids.assetNetwork,
        transferType: 'TOKEN',
        feeSnapshotId: ids.feeSnapshot,
        customerReference: `customer-${suffix}`,
        destinationAddress: overrides.destinationAddress ?? `0x${suffix}`,
        principalAtomic: overrides.principalAtomic ?? 25_000_000n,
        estimatedNativeFeeAtomic: 100n,
        bufferedNativeFeeAtomic: 113n,
        networkFeeAtomic: 300_000n,
        fixedServiceFeeAtomic: 200_000n,
        percentageServiceFeeAtomic: 60_000n,
        serviceFeeAtomic: 260_000n,
        totalDebitAtomic: 25_560_000n,
        recipientAmountAtomic: 25_000_000n,
        assetDecimals: 6,
        nativeFeeAssetDecimals: 8,
        createdAt: new Date('2026-09-03T07:30:00.000Z'),
        expiresAt: overrides.expiresAt ?? new Date('2026-09-03T09:00:00.000Z'),
      },
    });
  }

  beforeAll(async () => {
    await Promise.all([prisma.$connect(), secondPrisma.$connect()]);
    const configuration = await prisma.configurationVersion.create({
      data: { description: `Withdrawal integration ${suffix}`, actorId: 'system:integration-test' },
    });
    configurationVersionId = configuration.id;
    await prisma.asset.createMany({
      data: [
        {
          id: ids.nativeAsset,
          symbol: `N${suffix.slice(0, 8)}`,
          name: `Native ${suffix}`,
          kind: 'NATIVE',
          decimals: 8,
        },
        {
          id: ids.tokenAsset,
          symbol: `T${suffix.slice(0, 8)}`,
          name: `Token ${suffix}`,
          kind: 'TOKEN',
          decimals: 6,
        },
      ],
    });
    await prisma.network.create({
      data: {
        id: ids.network,
        code: `WD${suffix}`,
        name: `Withdrawal Network ${suffix}`,
        nativeAssetId: ids.nativeAsset,
        addressFamily: 'TEST',
        requiredConfirmations: 1,
      },
    });
    await prisma.assetNetwork.create({
      data: {
        id: ids.assetNetwork,
        assetId: ids.tokenAsset,
        networkId: ids.network,
        tokenStandard: 'TEST_TOKEN',
        networkDecimals: 6,
        withdrawalsEnabled: true,
        minWithdrawalAtomic: 1_000_000n,
        maxWithdrawalAtomic: 100_000_000n,
      },
    });
    await prisma.networkFeePolicyVersion.create({
      data: {
        id: ids.feePolicy,
        assetNetworkId: ids.assetNetwork,
        version: 1,
        transferType: 'TOKEN',
        nativeFeeAssetId: ids.nativeAsset,
        chargeAssetId: ids.tokenAsset,
        requiredObservations: 1,
        maxDeviationBps: 500,
        percentageBufferBps: 1_000,
        fixedBufferAtomic: 3n,
        fixedServiceFeeAtomic: 200_000n,
        percentageServiceFeeBps: 100,
        observationTtlSeconds: 30,
        snapshotTtlSeconds: 3_600,
        quoteTtlSeconds: 3_600,
        executionToleranceBps: 1_000,
        refreshIntervalSeconds: 15,
        configurationVersionId,
        actorId: 'system:integration-test',
        reason: 'Verify Sprint 8 withdrawals',
        effectiveFrom: new Date('2026-09-03T07:00:00.000Z'),
      },
    });
    await prisma.networkFeeSnapshot.create({
      data: {
        id: ids.feeSnapshot,
        policyId: ids.feePolicy,
        status: 'ACCEPTED',
        estimatedNativeFeeAtomic: 100n,
        percentageBufferAtomic: 10n,
        fixedBufferAtomic: 3n,
        bufferedNativeFeeAtomic: 113n,
        chargedNetworkFeeAtomic: 300_000n,
        deviationBps: 0,
        calculatedAt: new Date('2026-09-03T07:30:00.000Z'),
        expiresAt: new Date('2026-09-04T07:30:00.000Z'),
      },
    });
    await prisma.withdrawalPolicyVersion.create({
      data: {
        id: ids.withdrawalPolicy,
        assetNetworkId: ids.assetNetwork,
        version: 1,
        transferType: 'TOKEN',
        autoApproveMaxAtomic: 100_000_000n,
        maxFeeQuoteAgeSeconds: 3_600,
        configurationVersionId,
        actorId: 'system:integration-test',
        reason: 'Verify Sprint 8 auto-approval',
        effectiveFrom: new Date('2026-09-03T07:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await Promise.all([prisma.onModuleDestroy(), secondPrisma.onModuleDestroy()]);
  });

  it('auto-approves under the policy threshold and creates a due submission job', async () => {
    const now = new Date('2026-09-03T08:00:00.000Z');
    const quote = await createFeeQuote();
    const result = await withdrawals.create({
      feeQuoteId: quote.id,
      customerReference: `customer-${suffix}`,
      clientLockReference: `lock-a-${suffix}`,
      clientReference: `withdrawal-a-${suffix}`,
      destinationAddress: quote.destinationAddress,
      correlationId: randomUUID(),
      createdAt: now,
    });
    if (result.kind !== 'SUCCESS') throw new Error('expected success');
    expect(result.value.status).toBe('POLICY_APPROVED');
    expect(result.value.externalTxId).toBe(result.value.id);
    await expect(
      prisma.withdrawalSubmissionJob.findUniqueOrThrow({
        where: { withdrawalId: result.value.id },
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('rejects a fee quote already consumed by another withdrawal', async () => {
    const now = new Date('2026-09-03T08:00:00.000Z');
    const quote = await createFeeQuote();
    const first = await withdrawals.create({
      feeQuoteId: quote.id,
      customerReference: `customer-${suffix}`,
      clientLockReference: `lock-b-${suffix}`,
      clientReference: `withdrawal-b-${suffix}`,
      destinationAddress: quote.destinationAddress,
      correlationId: randomUUID(),
      createdAt: now,
    });
    expect(first.kind).toBe('SUCCESS');
    const second = await withdrawals.create({
      feeQuoteId: quote.id,
      customerReference: `customer-${suffix}`,
      clientLockReference: `lock-c-${suffix}`,
      clientReference: `withdrawal-c-${suffix}`,
      destinationAddress: quote.destinationAddress,
      correlationId: randomUUID(),
      createdAt: now,
    });
    expect(second).toEqual({ kind: 'FAILURE', code: 'FEE_QUOTE_ALREADY_USED' });
  });

  it('rejects a destination address that does not match the fee quote', async () => {
    const now = new Date('2026-09-03T08:00:00.000Z');
    const quote = await createFeeQuote({ destinationAddress: `0xoriginal${suffix}` });
    const result = await withdrawals.create({
      feeQuoteId: quote.id,
      customerReference: `customer-${suffix}`,
      clientLockReference: `lock-d-${suffix}`,
      clientReference: `withdrawal-d-${suffix}`,
      destinationAddress: `0xsubstituted${suffix}`,
      correlationId: randomUUID(),
      createdAt: now,
    });
    expect(result).toEqual({ kind: 'FAILURE', code: 'DESTINATION_ADDRESS_MISMATCH' });
  });

  it('rejects an expired fee quote', async () => {
    const now = new Date('2026-09-03T08:00:00.000Z');
    const quote = await createFeeQuote({ expiresAt: new Date('2026-09-03T07:59:59.000Z') });
    const result = await withdrawals.create({
      feeQuoteId: quote.id,
      customerReference: `customer-${suffix}`,
      clientLockReference: `lock-e-${suffix}`,
      clientReference: `withdrawal-e-${suffix}`,
      destinationAddress: quote.destinationAddress,
      correlationId: randomUUID(),
      createdAt: now,
    });
    expect(result).toEqual({ kind: 'FAILURE', code: 'FEE_QUOTE_EXPIRED' });
  });

  it('allows only one worker to claim a submission job, submits, and completes it', async () => {
    const now = new Date('2026-09-03T08:00:00.000Z');
    const quote = await createFeeQuote();
    const created = await withdrawals.create({
      feeQuoteId: quote.id,
      customerReference: `customer-${suffix}`,
      clientLockReference: `lock-f-${suffix}`,
      clientReference: `withdrawal-f-${suffix}`,
      destinationAddress: quote.destinationAddress,
      correlationId: randomUUID(),
      createdAt: now,
    });
    if (created.kind !== 'SUCCESS') throw new Error('expected success');

    const [first, second] = await Promise.all([
      jobs.claimBatch({ limit: 10, leaseSeconds: 30, leaseToken: randomUUID(), now }),
      secondJobs.claimBatch({ limit: 10, leaseSeconds: 30, leaseToken: randomUUID(), now }),
    ]);
    const claims = [...first, ...second].filter((claim) => claim.withdrawalId === created.value.id);
    expect(claims).toHaveLength(1);
    const claim = claims[0]!;

    const context = await jobs.beginSubmitting(claim, randomUUID(), now);
    expect(context).toMatchObject({
      withdrawalId: created.value.id,
      externalTxId: created.value.id,
      assetNetworkId: ids.assetNetwork,
    });
    await expect(
      prisma.withdrawal.findUniqueOrThrow({ where: { id: created.value.id } }),
    ).resolves.toMatchObject({ status: 'SUBMITTING' });

    await jobs.recordOutcome(
      claim,
      { kind: 'SUBMITTED', providerTransferId: `ftx-${suffix}` },
      randomUUID(),
      now,
    );
    await expect(
      prisma.withdrawal.findUniqueOrThrow({ where: { id: created.value.id } }),
    ).resolves.toMatchObject({ status: 'SUBMITTED', providerTransferId: `ftx-${suffix}` });
    await expect(
      prisma.withdrawalSubmissionJob.findUniqueOrThrow({ where: { id: claim.jobId } }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });

    // Immutability: a submitted withdrawal cannot be mutated further.
    await expect(
      prisma.withdrawal.update({ where: { id: created.value.id }, data: { status: 'CREATED' } }),
    ).rejects.toBeDefined();
    await expect(
      prisma.withdrawalTransition.deleteMany({ where: { withdrawalId: created.value.id } }),
    ).rejects.toBeDefined();
  });

  it('rejects cancellation once the submission job has been claimed', async () => {
    const now = new Date('2026-09-03T08:00:00.000Z');
    const quote = await createFeeQuote();
    const created = await withdrawals.create({
      feeQuoteId: quote.id,
      customerReference: `customer-${suffix}`,
      clientLockReference: `lock-g-${suffix}`,
      clientReference: `withdrawal-g-${suffix}`,
      destinationAddress: quote.destinationAddress,
      correlationId: randomUUID(),
      createdAt: now,
    });
    if (created.kind !== 'SUCCESS') throw new Error('expected success');
    await jobs.claimBatch({ limit: 10, leaseSeconds: 30, leaseToken: randomUUID(), now });

    const cancelled = await withdrawals.cancel({
      withdrawalId: created.value.id,
      correlationId: randomUUID(),
      cancelledAt: now,
    });
    expect(cancelled).toEqual({ kind: 'FAILURE', code: 'WITHDRAWAL_ALREADY_CLAIMED' });
  });

  it('cancels safely while the submission job remains unclaimed', async () => {
    const now = new Date('2026-09-03T08:00:00.000Z');
    const quote = await createFeeQuote();
    const created = await withdrawals.create({
      feeQuoteId: quote.id,
      customerReference: `customer-${suffix}`,
      clientLockReference: `lock-h-${suffix}`,
      clientReference: `withdrawal-h-${suffix}`,
      destinationAddress: quote.destinationAddress,
      correlationId: randomUUID(),
      createdAt: now,
    });
    if (created.kind !== 'SUCCESS') throw new Error('expected success');

    const cancelled = await withdrawals.cancel({
      withdrawalId: created.value.id,
      correlationId: randomUUID(),
      cancelledAt: now,
    });
    expect(cancelled).toMatchObject({ kind: 'SUCCESS', value: { status: 'CANCELLED' } });
    await expect(
      prisma.withdrawalSubmissionJob.findUnique({ where: { withdrawalId: created.value.id } }),
    ).resolves.toBeNull();
  });
});
