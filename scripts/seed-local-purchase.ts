import { PrismaTreasuryRepository, PrismaService } from '../packages/database/src';

const ids = {
  configuration: 1,
  usdt: '00000000-0000-4000-8000-000000000003',
  trx: '10000000-0000-4000-8000-000000000002',
  ngn: '00000000-0000-4000-8000-000000000004',
  tron: '10000000-0000-4000-8000-000000000004',
  usdtTron: '10000000-0000-4000-8000-000000000005',
  market: '00000000-0000-4000-8000-000000000009',
  usdtInstrument: '10000000-0000-4000-8000-000000000007',
  ngnInstrument: '10000000-0000-4000-8000-000000000008',
  provider: '10000000-0000-4000-8000-000000000009',
  pair: '10000000-0000-4000-8000-000000000010',
  route: '10000000-0000-4000-8000-000000000011',
  leg: '10000000-0000-4000-8000-000000000012',
  policy: '10000000-0000-4000-8000-000000000013',
  custody: '10000000-0000-4000-8000-000000000014',
  wallet: '10000000-0000-4000-8000-000000000015',
  credential: '10000000-0000-4000-8000-000000000016',
};

async function seed(): Promise<void> {
  const prisma = new PrismaService();
  const treasury = new PrismaTreasuryRepository(prisma);
  await prisma.$connect();

  try {
    await prisma.serviceCredential.upsert({
      where: { keyId: 'sendaza-local-1' },
      update: { status: 'ACTIVE', validUntil: null, revokedAt: null },
      create: {
        id: ids.credential,
        clientId: 'sendaza-core-local',
        keyId: 'sendaza-local-1',
        status: 'ACTIVE',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const configuration = await prisma.configurationVersion.upsert({
      where: { id: ids.configuration },
      update: {},
      create: {
        id: ids.configuration,
        description: 'Local USDT/TRON purchase testing',
        actorId: 'system:local-seed',
      },
    });
    await prisma.asset.upsert({
      where: { id: ids.trx },
      update: {},
      create: { id: ids.trx, symbol: 'TRX', name: 'TRON', kind: 'NATIVE', decimals: 6 },
    });
    await prisma.asset.upsert({
      where: { id: ids.usdt },
      update: {},
      create: { id: ids.usdt, symbol: 'USDT', name: 'Tether USD', kind: 'TOKEN', decimals: 6 },
    });
    await prisma.fiatCurrency.upsert({
      where: { id: ids.ngn },
      update: {},
      create: { id: ids.ngn, code: 'NGN', name: 'Nigerian Naira', decimals: 2 },
    });
    await prisma.network.upsert({
      where: { id: ids.tron },
      update: {},
      create: {
        id: ids.tron,
        code: 'TRON',
        name: 'TRON',
        nativeAssetId: ids.trx,
        addressFamily: 'TRON',
        requiredConfirmations: 20,
      },
    });
    await prisma.assetNetwork.upsert({
      where: { id: ids.usdtTron },
      update: {},
      create: {
        id: ids.usdtTron,
        assetId: ids.usdt,
        networkId: ids.tron,
        tokenStandard: 'TRC20',
        contractAddress: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj',
        networkDecimals: 6,
        providerAssetCode: 'USDT_TRX',
        depositsEnabled: true,
        withdrawalsEnabled: true,
      },
    });
    await prisma.market.upsert({
      where: { id: ids.market },
      update: { defaultBackingAssetNetworkId: ids.usdtTron },
      create: {
        id: ids.market,
        baseAssetId: ids.usdt,
        quoteFiatId: ids.ngn,
        defaultBackingAssetNetworkId: ids.usdtTron,
        minOrderAtomic: 10_000n,
        maxOrderAtomic: 100_000_000n,
        quoteTtlSeconds: 60,
        configurationVersionId: configuration.id,
      },
    });
    await prisma.pricingInstrument.upsert({
      where: { id: ids.usdtInstrument },
      update: {},
      create: { id: ids.usdtInstrument, kind: 'ASSET', assetId: ids.usdt },
    });
    await prisma.pricingInstrument.upsert({
      where: { id: ids.ngnInstrument },
      update: {},
      create: { id: ids.ngnInstrument, kind: 'FIAT', fiatCurrencyId: ids.ngn },
    });
    await prisma.pricingProvider.upsert({
      where: { id: ids.provider },
      update: {},
      create: { id: ids.provider, code: 'LOCAL_MANUAL', type: 'MANUAL' },
    });
    await prisma.providerPricePair.upsert({
      where: { id: ids.pair },
      update: {},
      create: {
        id: ids.pair,
        providerId: ids.provider,
        baseInstrumentId: ids.usdtInstrument,
        quoteInstrumentId: ids.ngnInstrument,
        providerPairCode: 'USDT_NGN_LOCAL',
        priceScale: 2,
        maxAgeSeconds: 3600,
      },
    });
    await prisma.conversionRoute.upsert({
      where: { id: ids.route },
      update: {},
      create: {
        id: ids.route,
        marketId: ids.market,
        version: 1,
        outputScale: 2,
        maxAgeSeconds: 3600,
        maxDeviationBps: 500,
        status: 'DISABLED',
        configurationVersionId: configuration.id,
      },
    });
    await prisma.conversionRouteLeg.upsert({
      where: { id: ids.leg },
      update: {},
      create: {
        id: ids.leg,
        routeId: ids.route,
        sequence: 1,
        providerPricePairId: ids.pair,
        operation: 'MULTIPLY',
      },
    });
    await prisma.conversionRoute.update({
      where: { id: ids.route },
      data: { status: 'ENABLED' },
    });
    await prisma.quotePolicyVersion.upsert({
      where: { id: ids.policy },
      update: {},
      create: {
        id: ids.policy,
        marketId: ids.market,
        version: 1,
        spreadBps: 100,
        fixedFeeAtomic: 10_000n,
        percentageFeeBps: 50,
        minTotalDebitAtomic: 100_000n,
        maxTotalDebitAtomic: 100_000_000n,
        quoteTtlSeconds: 60,
        rateDisplayScale: 2,
        status: 'ACTIVE',
        configurationVersionId: configuration.id,
        actorId: 'system:local-seed',
        reason: 'Local integration testing only',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const now = new Date();
    const observation = await prisma.priceObservation.create({
      data: {
        providerPricePairId: ids.pair,
        normalizedRate: '1600',
        rawRate: '1600',
        providerObservedAt: now,
        deduplicationKey: `local-${now.toISOString()}`,
        receivedAt: now,
      },
    });
    const snapshot = await prisma.referenceRateSnapshot.create({
      data: {
        routeId: ids.route,
        rate: '1600',
        outputScale: 2,
        roundingMode: 'HALF_EVEN',
        status: 'ACCEPTED',
        calculatedAt: now,
        validUntil: new Date(now.getTime() + 3_600_000),
        inputs: {
          create: { routeLegId: ids.leg, observationId: observation.id },
        },
      },
    });

    await prisma.custodyProviderConfiguration.upsert({
      where: { id: ids.custody },
      update: {},
      create: { id: ids.custody, code: 'LOCAL_FAKE', type: 'DETERMINISTIC_FAKE' },
    });
    await prisma.treasuryWallet.upsert({
      where: { id: ids.wallet },
      update: {},
      create: {
        id: ids.wallet,
        assetNetworkId: ids.usdtTron,
        custodyProviderId: ids.custody,
        providerVaultId: 'local-vault-1',
        providerAssetId: 'USDT_TRX',
        publicAddress: 'TLocalTestingAddressNotForRealFunds111',
        verificationRequired: true,
        safetyBufferAtomic: 1_000_000n,
        gasReserveAtomic: 0n,
        staleAfterSeconds: 3600,
        status: 'ENABLED',
      },
    });
    const inventory = await treasury.saveSnapshot({
      walletId: ids.wallet,
      assetNetworkId: ids.usdtTron,
      controlledAtomic: 1_000_000_000n,
      providerAvailableAtomic: 1_000_000_000n,
      pendingAtomic: 0n,
      frozenAtomic: 0n,
      lockedAtomic: 0n,
      chainConfirmedAtomic: 1_000_000_000n,
      safetyBufferAtomic: 1_000_000n,
      gasReserveAtomic: 0n,
      unavailableAtomic: 0n,
      verificationStatus: 'MATCHED',
      providerReference: `local-${now.toISOString()}`,
      observedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
    });

    process.stdout.write(
      `${JSON.stringify({ marketId: ids.market, assetNetworkId: ids.usdtTron, rateSnapshotId: snapshot.id, treasurySnapshotId: inventory.snapshotId }, null, 2)}\n`,
    );
  } finally {
    await prisma.onModuleDestroy();
  }
}

void seed().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
