import { randomUUID } from 'node:crypto';
import { WithdrawalFeeQuoteService, calculateNetworkFee } from '../../domain/src';
import { PrismaNetworkFeeRefreshJobRepository } from './prisma-network-fee-refresh-job.repository';
import { PrismaNetworkFeeRepository } from './prisma-network-fee.repository';
import { PrismaService } from './prisma.service';

describe('network fee PostgreSQL integration', () => {
  const prisma = new PrismaService();
  const secondPrisma = new PrismaService();
  const repository = new PrismaNetworkFeeRepository(prisma);
  const jobs = new PrismaNetworkFeeRefreshJobRepository(prisma);
  const secondJobs = new PrismaNetworkFeeRefreshJobRepository(secondPrisma);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const ids = {
    nativeAsset: randomUUID(),
    tokenAsset: randomUUID(),
    network: randomUUID(),
    assetNetwork: randomUUID(),
    policy: randomUUID(),
    conversion: randomUUID(),
    job: randomUUID(),
  };
  let configurationVersionId: number;

  beforeAll(async () => {
    await Promise.all([prisma.$connect(), secondPrisma.$connect()]);
    const configuration = await prisma.configurationVersion.create({
      data: { description: `Fee integration ${suffix}`, actorId: 'system:integration-test' },
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
        code: `FEE${suffix}`,
        name: `Fee Network ${suffix}`,
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
        contractAddress: `contract-${suffix}`,
        networkDecimals: 6,
        withdrawalsEnabled: true,
        minWithdrawalAtomic: 1_000_000n,
        maxWithdrawalAtomic: 100_000_000n,
      },
    });
    await prisma.feeConversionEvidence.create({
      data: {
        id: ids.conversion,
        fromAssetId: ids.nativeAsset,
        toAssetId: ids.tokenAsset,
        numerator: 5n,
        denominator: 2n,
        sourceReference: `conversion-${suffix}`,
        observedAt: new Date('2026-09-03T08:00:00.000Z'),
        expiresAt: new Date('2026-09-03T09:00:00.000Z'),
      },
    });
    await prisma.networkFeePolicyVersion.create({
      data: {
        id: ids.policy,
        assetNetworkId: ids.assetNetwork,
        version: 1,
        transferType: 'TOKEN',
        nativeFeeAssetId: ids.nativeAsset,
        chargeAssetId: ids.tokenAsset,
        requiredObservations: 2,
        maxDeviationBps: 500,
        percentageBufferBps: 1_000,
        fixedBufferAtomic: 3n,
        fixedServiceFeeAtomic: 10_000n,
        percentageServiceFeeBps: 100,
        observationTtlSeconds: 30,
        snapshotTtlSeconds: 60,
        quoteTtlSeconds: 30,
        executionToleranceBps: 1_000,
        refreshIntervalSeconds: 15,
        configurationVersionId,
        actorId: 'system:integration-test',
        reason: 'Verify Sprint 7 network fees',
        effectiveFrom: new Date('2026-09-03T07:00:00.000Z'),
      },
    });
    await prisma.networkFeeRefreshJob.create({
      data: {
        id: ids.job,
        policyId: ids.policy,
        nextRefreshAt: new Date('2026-09-03T07:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await Promise.all([prisma.onModuleDestroy(), secondPrisma.onModuleDestroy()]);
  });

  it('publishes immutable dual-source evidence and creates an exact token fee quote', async () => {
    const now = new Date('2026-09-03T08:00:00.000Z');
    const policy = await repository.loadPolicy(ids.policy, now);
    if (!policy) throw new Error('expected fee policy');
    const observations = [
      {
        source: 'PROVIDER' as const,
        estimatedNativeFeeAtomic: 100n,
        observedAt: now,
        expiresAt: new Date(now.getTime() + 30_000),
      },
      {
        source: 'RPC' as const,
        estimatedNativeFeeAtomic: 105n,
        observedAt: now,
        expiresAt: new Date(now.getTime() + 30_000),
      },
    ];
    const calculation = calculateNetworkFee({ ...policy, observations, now });
    const snapshot = await repository.saveRefresh({
      policy,
      observations,
      calculation,
      calculatedAt: now,
    });
    const quote = await new WithdrawalFeeQuoteService(repository, () => now).create({
      assetNetworkId: ids.assetNetwork,
      transferType: 'TOKEN',
      amount: '25.000000',
      destinationAddress: `destination-${suffix}`,
      customerReference: `customer-${suffix}`,
    });
    expect(quote).toMatchObject({
      assetNetworkId: ids.assetNetwork,
      principal: '25.000000',
      networkFee: '0.000298',
      recipientAmount: '25.000000',
      totalDebit: '25.260298',
    });
    await expect(
      repository.loadQuoteContext(
        ids.assetNetwork,
        'TOKEN',
        new Date('2026-09-03T08:01:01.000Z'),
      ),
    ).resolves.toBeNull();
    await expect(
      prisma.networkFeeSnapshot.update({
        where: { id: snapshot.id },
        data: { chargedNetworkFeeAtomic: 1n },
      }),
    ).rejects.toBeDefined();
  });

  it('allows only one worker to claim a due policy', async () => {
    const now = new Date('2026-09-03T08:01:00.000Z');
    const leaseToken = randomUUID();
    const [first, second] = await Promise.all([
      jobs.claimBatch({ limit: 10, leaseSeconds: 30, leaseToken, now }),
      secondJobs.claimBatch({ limit: 10, leaseSeconds: 30, leaseToken: randomUUID(), now }),
    ]);
    expect([...first, ...second].filter((claim) => claim.policyId === ids.policy)).toHaveLength(1);
  });

});
