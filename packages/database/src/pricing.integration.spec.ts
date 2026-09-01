import { randomUUID } from 'node:crypto';
import { createObservationDeduplicationKey } from '../../domain/src';
import { PrismaPricingRefreshJobRepository } from './prisma-pricing-refresh-job.repository';
import { PrismaPricingRepository } from './prisma-pricing.repository';
import { PrismaService } from './prisma.service';

describe('pricing PostgreSQL integration', () => {
  const prisma = new PrismaService();
  const secondPrisma = new PrismaService();
  const pricing = new PrismaPricingRepository(prisma);
  const secondPricing = new PrismaPricingRepository(secondPrisma);
  const jobs = new PrismaPricingRefreshJobRepository(prisma);
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
});
