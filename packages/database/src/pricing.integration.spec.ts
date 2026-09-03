import { randomUUID } from 'node:crypto';
import { QuoteService, createObservationDeduplicationKey } from '../../domain/src';
import { PrismaQuoteRepository } from './prisma-quote.repository';
import {
  PrismaPurchaseRepository,
  PrismaPurchaseTimeoutRepository,
} from './prisma-purchase.repository';
import { PrismaTreasuryRepository } from './prisma-treasury.repository';
import { PrismaPricingRefreshJobRepository } from './prisma-pricing-refresh-job.repository';
import { PrismaPricingRepository } from './prisma-pricing.repository';
import { PrismaService } from './prisma.service';

describe('pricing PostgreSQL integration', () => {
  const prisma = new PrismaService();
  const secondPrisma = new PrismaService();
  const pricing = new PrismaPricingRepository(prisma);
  const secondPricing = new PrismaPricingRepository(secondPrisma);
  const jobs = new PrismaPricingRefreshJobRepository(prisma);
  const quotes = new PrismaQuoteRepository(prisma);
  const purchases = new PrismaPurchaseRepository(prisma);
  const secondPurchases = new PrismaPurchaseRepository(secondPrisma);
  const purchaseTimeouts = new PrismaPurchaseTimeoutRepository(prisma);
  const treasury = new PrismaTreasuryRepository(prisma);
  const secondJobs = new PrismaPricingRefreshJobRepository(secondPrisma);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const ids = {
    asset: randomUUID(),
    fiat: randomUUID(),
    network: randomUUID(),
    assetNetwork: randomUUID(),
    market: randomUUID(),
    assetInstrument: randomUUID(),
    fiatInstrument: randomUUID(),
    provider: randomUUID(),
    pair: randomUUID(),
    route: randomUUID(),
    leg: randomUUID(),
    job: randomUUID(),
    policy: randomUUID(),
  };
  let configurationVersionId: number;
  let observationId: string;

  beforeAll(async () => {
    await prisma.$connect();
    await secondPrisma.$connect();
    const configuration = await prisma.configurationVersion.create({
      data: { description: `Pricing integration ${suffix}`, actorId: 'system:integration-test' },
    });
    configurationVersionId = configuration.id;
    await prisma.asset.create({
      data: {
        id: ids.asset,
        symbol: `T${suffix.slice(0, 8)}`,
        name: `Integration Asset ${suffix}`,
        kind: 'NATIVE',
        decimals: 8,
      },
    });
    await prisma.fiatCurrency.create({
      data: {
        id: ids.fiat,
        code: suffix.slice(0, 3),
        name: `Integration Fiat ${suffix}`,
        decimals: 2,
      },
    });
    await prisma.network.create({
      data: {
        id: ids.network,
        code: `NET${suffix}`,
        name: `Integration Network ${suffix}`,
        nativeAssetId: ids.asset,
        addressFamily: 'TEST',
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
      },
    });
    await prisma.market.create({
      data: {
        id: ids.market,
        baseAssetId: ids.asset,
        quoteFiatId: ids.fiat,
        defaultBackingAssetNetworkId: ids.assetNetwork,
        minOrderAtomic: 1n,
        maxOrderAtomic: 1_000_000n,
        quoteTtlSeconds: 15,
        configurationVersionId,
      },
    });
    await prisma.pricingInstrument.createMany({
      data: [
        { id: ids.assetInstrument, kind: 'ASSET', assetId: ids.asset },
        { id: ids.fiatInstrument, kind: 'FIAT', fiatCurrencyId: ids.fiat },
      ],
    });
    await prisma.pricingProvider.create({
      data: { id: ids.provider, code: `TEST_${suffix}`, type: 'DETERMINISTIC_FAKE' },
    });
    await prisma.providerPricePair.create({
      data: {
        id: ids.pair,
        providerId: ids.provider,
        baseInstrumentId: ids.assetInstrument,
        quoteInstrumentId: ids.fiatInstrument,
        providerPairCode: `PAIR-${suffix}`,
        priceScale: 2,
        maxAgeSeconds: 60,
        sequenceEnforced: true,
      },
    });
    await prisma.conversionRoute.create({
      data: {
        id: ids.route,
        marketId: ids.market,
        version: 1,
        outputScale: 2,
        maxAgeSeconds: 30,
        maxDeviationBps: 500,
        status: 'DISABLED',
        configurationVersionId,
      },
    });
    await prisma.conversionRouteLeg.create({
      data: {
        id: ids.leg,
        routeId: ids.route,
        sequence: 1,
        providerPricePairId: ids.pair,
        operation: 'MULTIPLY',
      },
    });
    await prisma.conversionRoute.update({ where: { id: ids.route }, data: { status: 'ENABLED' } });
    await prisma.quotePolicyVersion.create({
      data: {
        id: ids.policy,
        marketId: ids.market,
        version: 1,
        spreadBps: 100,
        fixedFeeAtomic: 100n,
        percentageFeeBps: 100,
        minTotalDebitAtomic: 1_000n,
        maxTotalDebitAtomic: 1_000_000n,
        quoteTtlSeconds: 15,
        rateDisplayScale: 4,
        status: 'ACTIVE',
        configurationVersionId,
        actorId: 'system:integration-test',
        reason: 'Verify Sprint 4 quote persistence',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await Promise.all([prisma.onModuleDestroy(), secondPrisma.onModuleDestroy()]);
  });

  it('deduplicates concurrent identical provider evidence', async () => {
    const observedAt = new Date();
    const input = { price: '1600.25', observedAt, providerSequence: '1' };
    const deduplicationKey = createObservationDeduplicationKey(ids.pair, input);
    const observation = {
      providerPairId: ids.pair,
      normalizedRate: input.price,
      rawRate: input.price,
      providerObservedAt: observedAt,
      providerSequence: input.providerSequence,
      deduplicationKey,
      receivedAt: observedAt,
    };
    const results = await Promise.all([
      pricing.insertObservation(observation),
      secondPricing.insertObservation(observation),
    ]);
    expect(results.filter((result) => result.inserted)).toHaveLength(1);
    expect(new Set(results.map((result) => result.id))).toHaveProperty('size', 1);
    expect(
      await prisma.priceObservation.count({
        where: { providerPricePairId: ids.pair, deduplicationKey },
      }),
    ).toBe(1);
    observationId = results[0]!.id;
  });

  it('allows only one concurrent worker to claim a due market', async () => {
    await prisma.pricingRefreshJob.create({
      data: {
        id: ids.job,
        marketId: ids.market,
        refreshIntervalSeconds: 15,
        nextRefreshAt: new Date('1970-01-01T00:00:00.000Z'),
      },
    });
    const now = new Date();
    const [first, second] = await Promise.all([
      jobs.claimBatch({ limit: 100, leaseSeconds: 30, leaseToken: randomUUID(), now }),
      secondJobs.claimBatch({ limit: 100, leaseSeconds: 30, leaseToken: randomUUID(), now }),
    ]);
    const currentClaims = [...first, ...second].filter((claim) => claim.marketId === ids.market);
    expect(currentClaims).toHaveLength(1);
  });

  it('reclaims an expired lease after a worker restart', async () => {
    const crashedLeaseToken = randomUUID();
    const restartedLeaseToken = randomUUID();
    const restartedAt = new Date();
    await prisma.pricingRefreshJob.update({
      where: { id: ids.job },
      data: {
        status: 'LEASED',
        leaseToken: crashedLeaseToken,
        leaseExpiresAt: new Date(restartedAt.getTime() - 1_000),
      },
    });

    const claims = await jobs.claimBatch({
      limit: 100,
      leaseSeconds: 30,
      leaseToken: restartedLeaseToken,
      now: restartedAt,
    });
    const reclaimed = claims.find((claim) => claim.marketId === ids.market);

    expect(reclaimed).toMatchObject({
      id: ids.job,
      marketId: ids.market,
      leaseToken: restartedLeaseToken,
      attemptCount: 2,
    });
    expect(reclaimed?.leaseExpiresAt).toEqual(new Date(restartedAt.getTime() + 30_000));
  });

  it('commits a snapshot and its exact input atomically', async () => {
    const calculatedAt = new Date();
    const snapshotId = await pricing.saveEvaluation({
      status: 'ACCEPTED',
      routeId: ids.route,
      routeVersion: 1,
      rate: '1600.25',
      outputScale: 2,
      roundingMode: 'HALF_EVEN',
      calculatedAt,
      validUntil: new Date(calculatedAt.getTime() + 30_000),
      inputs: [{ routeLegId: ids.leg, observationId }],
    });
    const snapshot = await prisma.referenceRateSnapshot.findUnique({
      where: { id: snapshotId },
      include: { inputs: true },
    });
    expect(snapshot?.status).toBe('ACCEPTED');
    expect(snapshot?.inputs).toHaveLength(1);

    const countBefore = await prisma.referenceRateSnapshot.count({ where: { routeId: ids.route } });
    await expect(
      pricing.saveEvaluation({
        status: 'ACCEPTED',
        routeId: ids.route,
        routeVersion: 1,
        rate: '1600.25',
        outputScale: 2,
        roundingMode: 'HALF_EVEN',
        calculatedAt,
        validUntil: new Date(calculatedAt.getTime() + 30_000),
        inputs: [{ routeLegId: randomUUID(), observationId }],
      }),
    ).rejects.toBeDefined();
    expect(await prisma.referenceRateSnapshot.count({ where: { routeId: ids.route } })).toBe(
      countBefore,
    );
  });

  it('enforces immutable pricing evidence in PostgreSQL', async () => {
    await expect(
      prisma.priceObservation.update({
        where: { id: observationId },
        data: { rawRate: '1601.00' },
      }),
    ).rejects.toBeDefined();
    expect(
      await prisma.priceObservation.findUnique({
        where: { id: observationId },
        select: { rawRate: true },
      }),
    ).toEqual({ rawRate: '1600.25' });
  });

  it('persists an executable quote and protects its calculation evidence', async () => {
    const createdAt = new Date();
    await pricing.saveEvaluation({
      status: 'ACCEPTED',
      routeId: ids.route,
      routeVersion: 1,
      rate: '1600.25',
      outputScale: 2,
      roundingMode: 'HALF_EVEN',
      calculatedAt: createdAt,
      validUntil: new Date(createdAt.getTime() + 30_000),
      inputs: [{ routeLegId: ids.leg, observationId }],
    });
    const service = new QuoteService(quotes, () => createdAt);
    const result = await service.createBuyQuote({ marketId: ids.market, debitAmount: '2000.00' });
    const stored = await prisma.quote.findUniqueOrThrow({ where: { id: result.quoteId } });

    expect(stored.totalDebitAtomic).toBe(200_000n);
    expect(result.destinationAmount).toMatch(/^\d+\.\d{8}$/);
    await expect(
      prisma.quote.update({ where: { id: result.quoteId }, data: { spreadAmountAtomic: 0n } }),
    ).rejects.toBeDefined();
    await expect(prisma.quote.delete({ where: { id: result.quoteId } })).rejects.toBeDefined();

    await expect(
      prisma.$executeRaw`INSERT INTO quotes (
        id, side, market_id, backing_asset_network_id,
        reference_rate_snapshot_id, quote_policy_version_id, configuration_version_id,
        total_debit_atomic, fixed_fee_atomic, percentage_fee_atomic, percentage_fee_bps,
        total_fee_atomic, trade_amount_atomic, spread_bps, spread_amount_atomic,
        destination_amount_atomic, quote_fiat_decimals, base_asset_decimals,
        reference_rate, customer_rate, rate_display_scale, fee_rounding_mode,
        destination_rounding_mode, expires_at, created_at
      ) SELECT
        ${randomUUID()}::uuid, side, market_id, backing_asset_network_id,
        reference_rate_snapshot_id, quote_policy_version_id, configuration_version_id,
        total_debit_atomic, fixed_fee_atomic, percentage_fee_atomic, percentage_fee_bps,
        total_fee_atomic, trade_amount_atomic, spread_bps, spread_amount_atomic,
        destination_amount_atomic + 1, quote_fiat_decimals, base_asset_decimals,
        reference_rate, customer_rate, rate_display_scale, fee_rounding_mode,
        destination_rounding_mode, expires_at, created_at
      FROM quotes WHERE id = ${result.quoteId}::uuid`,
    ).rejects.toBeDefined();
  });

  it('prevents oversell and converges committed, rolled-back, and timed-out purchases', async () => {
    const custodyProviderId = randomUUID();
    const walletId = randomUUID();
    await prisma.custodyProviderConfiguration.create({
      data: { id: custodyProviderId, code: `BUY_${suffix}`, type: 'DETERMINISTIC_FAKE' },
    });
    await prisma.treasuryWallet.create({
      data: {
        id: walletId,
        assetNetworkId: ids.assetNetwork,
        custodyProviderId,
        providerVaultId: `buy-vault-${suffix}`,
        providerAssetId: `buy-asset-${suffix}`,
        publicAddress: '0x00000000000000000000000000000000000000cc',
        verificationRequired: true,
        staleAfterSeconds: 60,
        status: 'ENABLED',
      },
    });
    const start = new Date();
    const observationInput = {
      price: '1600.25',
      observedAt: start,
      providerSequence: `purchase-${suffix}`,
    };
    const purchaseObservation = await pricing.insertObservation({
      providerPairId: ids.pair,
      normalizedRate: observationInput.price,
      rawRate: observationInput.price,
      providerObservedAt: observationInput.observedAt,
      providerSequence: observationInput.providerSequence,
      deduplicationKey: createObservationDeduplicationKey(ids.pair, observationInput),
      receivedAt: start,
    });
    await treasury.saveSnapshot({
      walletId,
      assetNetworkId: ids.assetNetwork,
      controlledAtomic: 200_000_000n,
      providerAvailableAtomic: 200_000_000n,
      pendingAtomic: 0n,
      frozenAtomic: 0n,
      lockedAtomic: 0n,
      chainConfirmedAtomic: 200_000_000n,
      safetyBufferAtomic: 0n,
      gasReserveAtomic: 0n,
      unavailableAtomic: 0n,
      verificationStatus: 'MATCHED',
      observedAt: start,
      expiresAt: new Date(start.getTime() + 60_000),
    });
    await pricing.saveEvaluation({
      status: 'ACCEPTED',
      routeId: ids.route,
      routeVersion: 1,
      rate: '1600.25',
      outputScale: 2,
      roundingMode: 'HALF_EVEN',
      calculatedAt: start,
      validUntil: new Date(start.getTime() + 30_000),
      inputs: [{ routeLegId: ids.leg, observationId: purchaseObservation.id }],
    });
    const quoteService = new QuoteService(quotes, () => start);
    const [firstQuote, secondQuote] = await Promise.all([
      quoteService.createBuyQuote({ marketId: ids.market, debitAmount: '2000.00' }),
      quoteService.createBuyQuote({ marketId: ids.market, debitAmount: '2000.00' }),
    ]);
    const correlationId = randomUUID();
    const results = await Promise.all([
      purchases.createReservation({
        quoteId: firstQuote.quoteId,
        customerReference: 'customer-a',
        clientLockReference: `lock-a-${suffix}`,
        clientReference: `buy-a-${suffix}`,
        correlationId,
        createdAt: start,
        reservationTtlSeconds: 60,
      }),
      secondPurchases.createReservation({
        quoteId: secondQuote.quoteId,
        customerReference: 'customer-b',
        clientLockReference: `lock-b-${suffix}`,
        clientReference: `buy-b-${suffix}`,
        correlationId,
        createdAt: start,
        reservationTtlSeconds: 60,
      }),
    ]);
    const accepted = results.find((result) => result.kind === 'SUCCESS');
    expect(results.filter((result) => result.kind === 'SUCCESS')).toHaveLength(1);
    expect(results.find((result) => result.kind === 'FAILURE')).toMatchObject({
      code: 'INSUFFICIENT_INVENTORY',
    });
    if (!accepted || accepted.kind !== 'SUCCESS') throw new Error('expected purchase');
    await expect(
      purchases.createReservation({
        quoteId: accepted.value.quoteId,
        customerReference: 'customer-a',
        clientLockReference: `lock-copy-${suffix}`,
        clientReference: `buy-copy-${suffix}`,
        correlationId,
        createdAt: start,
        reservationTtlSeconds: 60,
      }),
    ).resolves.toMatchObject({ kind: 'FAILURE', code: 'QUOTE_ALREADY_USED' });

    await expect(
      purchases.settle({
        purchaseId: accepted.value.id,
        outcome: 'COMMITTED',
        clientSettlementReference: `settle-a-${suffix}`,
        clientSettledAt: start,
        correlationId,
        recordedAt: new Date(start.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ kind: 'SUCCESS', value: { status: 'COMPLETED' } });
    await expect(
      prisma.treasuryInventoryState.findUniqueOrThrow({
        where: { assetNetworkId: ids.assetNetwork },
      }),
    ).resolves.toMatchObject({ reservedAtomic: 0n, allocatedAtomic: accepted.value.creditAtomic });

    const refreshedAt = new Date(start.getTime() + 2_000);
    await treasury.saveSnapshot({
      walletId,
      assetNetworkId: ids.assetNetwork,
      controlledAtomic: 400_000_000n,
      providerAvailableAtomic: 400_000_000n,
      pendingAtomic: 0n,
      frozenAtomic: 0n,
      lockedAtomic: 0n,
      chainConfirmedAtomic: 400_000_000n,
      safetyBufferAtomic: 0n,
      gasReserveAtomic: 0n,
      unavailableAtomic: 0n,
      verificationStatus: 'MATCHED',
      observedAt: refreshedAt,
      expiresAt: new Date(refreshedAt.getTime() + 60_000),
    });
    await pricing.saveEvaluation({
      status: 'ACCEPTED',
      routeId: ids.route,
      routeVersion: 1,
      rate: '1600.25',
      outputScale: 2,
      roundingMode: 'HALF_EVEN',
      calculatedAt: refreshedAt,
      validUntil: new Date(refreshedAt.getTime() + 30_000),
      inputs: [{ routeLegId: ids.leg, observationId: purchaseObservation.id }],
    });
    const nextQuote = await new QuoteService(quotes, () => refreshedAt).createBuyQuote({
      marketId: ids.market,
      debitAmount: '2000.00',
    });
    const rollbackPurchase = await purchases.createReservation({
      quoteId: nextQuote.quoteId,
      customerReference: 'customer-c',
      clientLockReference: `lock-c-${suffix}`,
      clientReference: `buy-c-${suffix}`,
      correlationId,
      createdAt: refreshedAt,
      reservationTtlSeconds: 60,
    });
    if (rollbackPurchase.kind !== 'SUCCESS') throw new Error('expected rollback purchase');
    await expect(
      purchases.settle({
        purchaseId: rollbackPurchase.value.id,
        outcome: 'ROLLED_BACK',
        clientSettlementReference: `rollback-c-${suffix}`,
        clientSettledAt: refreshedAt,
        correlationId,
        recordedAt: new Date(refreshedAt.getTime() + 1_000),
      }),
    ).resolves.toMatchObject({ kind: 'SUCCESS', value: { status: 'ROLLED_BACK' } });

    const timeoutQuote = await new QuoteService(quotes, () => refreshedAt).createBuyQuote({
      marketId: ids.market,
      debitAmount: '2000.00',
    });
    const timeoutPurchase = await purchases.createReservation({
      quoteId: timeoutQuote.quoteId,
      customerReference: 'customer-d',
      clientLockReference: `lock-d-${suffix}`,
      clientReference: `buy-d-${suffix}`,
      correlationId,
      createdAt: refreshedAt,
      reservationTtlSeconds: 5,
    });
    if (timeoutPurchase.kind !== 'SUCCESS') throw new Error('expected timeout purchase');
    const overdue = new Date(refreshedAt.getTime() + 6_000);
    const claims = await purchaseTimeouts.claimBatch({
      limit: 100,
      leaseSeconds: 30,
      leaseToken: randomUUID(),
      now: overdue,
    });
    const claim = claims.find((item) => item.purchaseId === timeoutPurchase.value.id)!;
    await purchaseTimeouts.reconcileOverdue(claim, overdue, correlationId);
    await expect(
      prisma.purchase.findUniqueOrThrow({
        where: { id: timeoutPurchase.value.id },
        include: { reservation: true },
      }),
    ).resolves.toMatchObject({
      status: 'RECONCILIATION_REQUIRED',
      reservation: { status: 'HELD_RECONCILIATION' },
    });
    expect(
      await prisma.outboxEvent.count({ where: { aggregateType: 'purchase' } }),
    ).toBeGreaterThanOrEqual(5);
  });
});
