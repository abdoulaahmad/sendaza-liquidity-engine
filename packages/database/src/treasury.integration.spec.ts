import { randomUUID } from 'node:crypto';
import {
  PrismaTreasuryRepository,
  PrismaTreasurySyncJobRepository,
} from './prisma-treasury.repository';
import { PrismaService } from './prisma.service';

describe('treasury PostgreSQL integration', () => {
  const prisma = new PrismaService();
  const secondPrisma = new PrismaService();
  const treasury = new PrismaTreasuryRepository(prisma);
  const jobs = new PrismaTreasurySyncJobRepository(prisma);
  const secondJobs = new PrismaTreasurySyncJobRepository(secondPrisma);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const ids = {
    asset: randomUUID(),
    network: randomUUID(),
    assetNetwork: randomUUID(),
    provider: randomUUID(),
    wallet: randomUUID(),
    job: randomUUID(),
  };

  beforeAll(async () => {
    await prisma.$connect();
    await secondPrisma.$connect();
    await prisma.asset.create({
      data: {
        id: ids.asset,
        symbol: `Z${suffix.slice(0, 8)}`,
        name: `Treasury Asset ${suffix}`,
        kind: 'NATIVE',
        decimals: 8,
      },
    });
    await prisma.network.create({
      data: {
        id: ids.network,
        code: `TNET${suffix}`,
        name: `Treasury Network ${suffix}`,
        nativeAssetId: ids.asset,
        addressFamily: 'EVM',
        requiredConfirmations: 1,
      },
    });
    await prisma.assetNetwork.create({
      data: {
        id: ids.assetNetwork,
        assetId: ids.asset,
        networkId: ids.network,
        tokenStandard: 'NATIVE',
        networkDecimals: 8,
        providerAssetCode: `FAKE_${suffix}`,
      },
    });
    await prisma.custodyProviderConfiguration.create({
      data: { id: ids.provider, code: `FAKE_${suffix}`, type: 'DETERMINISTIC_FAKE' },
    });
    await prisma.treasuryWallet.create({
      data: {
        id: ids.wallet,
        assetNetworkId: ids.assetNetwork,
        custodyProviderId: ids.provider,
        providerVaultId: `vault-${suffix}`,
        providerAssetId: `asset-${suffix}`,
        publicAddress: '0x00000000000000000000000000000000000000ab',
        verificationRequired: true,
        safetyBufferAtomic: 100n,
        gasReserveAtomic: 50n,
        staleAfterSeconds: 60,
        status: 'ENABLED',
      },
    });
    await prisma.treasurySyncJob.create({
      data: {
        id: ids.job,
        treasuryWalletId: ids.wallet,
        nextSyncAt: new Date('1970-01-01T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await Promise.all([prisma.onModuleDestroy(), secondPrisma.onModuleDestroy()]);
  });

  it('allows only one worker to claim a wallet and safely completes its lease', async () => {
    const now = new Date();
    const [first, second] = await Promise.all([
      jobs.claimBatch({ limit: 10, leaseSeconds: 30, leaseToken: randomUUID(), now }),
      secondJobs.claimBatch({ limit: 10, leaseSeconds: 30, leaseToken: randomUUID(), now }),
    ]);
    const claims = [...first, ...second].filter((claim) => claim.walletId === ids.wallet);
    expect(claims).toHaveLength(1);
    await jobs.complete(claims[0]!.jobId, claims[0]!.leaseToken, new Date(now.getTime() + 30_000));
    await expect(jobs.complete(claims[0]!.jobId, claims[0]!.leaseToken, now)).rejects.toThrow(
      'TREASURY_SYNC_LEASE_LOST',
    );
  });

  it('atomically publishes an immutable verified snapshot and current inventory', async () => {
    const observedAt = new Date();
    const stored = await treasury.saveSnapshot({
      walletId: ids.wallet,
      assetNetworkId: ids.assetNetwork,
      controlledAtomic: 10_000n,
      providerAvailableAtomic: 9_000n,
      pendingAtomic: 500n,
      frozenAtomic: 200n,
      lockedAtomic: 300n,
      chainConfirmedAtomic: 10_000n,
      safetyBufferAtomic: 100n,
      gasReserveAtomic: 50n,
      unavailableAtomic: 1_000n,
      verificationStatus: 'MATCHED',
      providerReference: 'block-100',
      observedAt,
      expiresAt: new Date(observedAt.getTime() + 60_000),
    });
    const snapshotId = stored.snapshotId;
    await expect(
      prisma.treasuryInventoryState.findUnique({ where: { assetNetworkId: ids.assetNetwork } }),
    ).resolves.toMatchObject({
      latestSnapshotId: snapshotId,
      sellableAtomic: 8_850n,
      verificationStatus: 'MATCHED',
    });
    await expect(
      prisma.treasurySnapshot.update({ where: { id: snapshotId }, data: { sellableAtomic: 0n } }),
    ).rejects.toBeDefined();
    await expect(
      prisma.treasurySnapshot.delete({ where: { id: snapshotId } }),
    ).rejects.toBeDefined();
  });

  it('rejects snapshot evidence that differs from wallet policy', async () => {
    const observedAt = new Date();
    await expect(
      treasury.saveSnapshot({
        walletId: ids.wallet,
        assetNetworkId: ids.assetNetwork,
        controlledAtomic: 10_000n,
        providerAvailableAtomic: 9_000n,
        pendingAtomic: 500n,
        frozenAtomic: 200n,
        lockedAtomic: 300n,
        chainConfirmedAtomic: 10_000n,
        safetyBufferAtomic: 100n,
        gasReserveAtomic: 51n,
        unavailableAtomic: 1_000n,
        verificationStatus: 'MATCHED',
        observedAt,
        expiresAt: new Date(observedAt.getTime() + 60_000),
      }),
    ).rejects.toBeDefined();
  });

  it('enforces auditable forward-only funding intent transitions', async () => {
    const intent = await prisma.treasuryFundingIntent.create({
      data: {
        treasuryWalletId: ids.wallet,
        assetNetworkId: ids.assetNetwork,
        expectedAtomic: 1_000n,
        actorId: 'operator:test',
        reason: 'Test funding workflow',
      },
    });
    const observedAt = new Date();
    await prisma.treasuryFundingIntent.update({
      where: { id: intent.id },
      data: { status: 'OBSERVED', transactionHash: '0xtest', observedAt },
    });
    await prisma.treasuryFundingIntent.update({
      where: { id: intent.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    });
    await expect(
      prisma.treasuryFundingIntent.delete({ where: { id: intent.id } }),
    ).rejects.toBeDefined();
  });
});
