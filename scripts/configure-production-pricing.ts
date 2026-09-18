import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../packages/database/src';

const RATE = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

type Pair = { id: string };
type Market = { id: string };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name] ?? fallback.toString();
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name}_INVALID`);
  const value = Number.parseInt(raw, 10);
  if (value < minimum || value > maximum) throw new Error(`${name}_INVALID`);
  return value;
}

async function configure(): Promise<void> {
  const usdNgnRate = required('SLE_MANUAL_USD_NGN_RATE');
  if (!RATE.test(usdNgnRate) || usdNgnRate === '0')
    throw new Error('SLE_MANUAL_USD_NGN_RATE_INVALID');
  const actorId = required('SLE_PRICING_CONFIGURATION_ACTOR_ID');
  const reason = required('SLE_PRICING_CONFIGURATION_REASON');
  const pairMaxAgeSeconds = boundedInteger('SLE_COINBASE_PAIR_MAX_AGE_SECONDS', 60, 10, 600);
  const manualMaxAgeSeconds = boundedInteger(
    'SLE_MANUAL_RATE_MAX_AGE_SECONDS',
    86_400,
    60,
    604_800,
  );
  const routeMaxAgeSeconds = boundedInteger(
    'SLE_PRICING_ROUTE_MAX_AGE_SECONDS',
    manualMaxAgeSeconds,
    60,
    604_800,
  );
  const maxDeviationBps = boundedInteger('SLE_PRICING_MAX_DEVIATION_BPS', 500, 1, 5_000);
  const depegToleranceBps = boundedInteger('SLE_USDT_DEPEG_TOLERANCE_BPS', 200, 1, 2_000);
  const refreshIntervalSeconds = boundedInteger('SLE_PRICING_REFRESH_INTERVAL_SECONDS', 30, 5, 300);
  const now = new Date();
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const configuration = await tx.configurationVersion.create({
          data: { description: 'USDT-bridge Coinbase production pricing routes', actorId },
        });
        const [eth, sol, usdt] = await Promise.all([
          tx.asset.findUniqueOrThrow({ where: { symbol: 'ETH' } }),
          tx.asset.findUniqueOrThrow({ where: { symbol: 'SOL' } }),
          tx.asset.findUniqueOrThrow({ where: { symbol: 'USDT' } }),
        ]);
        const ngn = await tx.fiatCurrency.findUniqueOrThrow({ where: { code: 'NGN' } });
        const usd = await tx.fiatCurrency.upsert({
          where: { code: 'USD' },
          update: { status: 'ENABLED' },
          create: { code: 'USD', name: 'United States Dollar', decimals: 2 },
        });
        const [ethereum, solana] = await Promise.all([
          tx.network.findUniqueOrThrow({ where: { code: 'ETHEREUM' } }),
          tx.network.findUniqueOrThrow({ where: { code: 'SOLANA' } }),
        ]);
        const ethNetwork = await tx.assetNetwork.upsert({
          where: { assetId_networkId: { assetId: eth.id, networkId: ethereum.id } },
          update: { status: 'ENABLED' },
          create: {
            assetId: eth.id,
            networkId: ethereum.id,
            tokenStandard: 'NATIVE',
            networkDecimals: 18,
            providerAssetCode: 'ETH',
            depositsEnabled: true,
            withdrawalsEnabled: true,
          },
        });
        const solNetwork = await tx.assetNetwork.upsert({
          where: { assetId_networkId: { assetId: sol.id, networkId: solana.id } },
          update: { status: 'ENABLED' },
          create: {
            assetId: sol.id,
            networkId: solana.id,
            tokenStandard: 'NATIVE',
            networkDecimals: 9,
            providerAssetCode: 'SOL',
            depositsEnabled: true,
            withdrawalsEnabled: true,
          },
        });
        const usdtNetwork = await tx.assetNetwork.findFirstOrThrow({
          where: { assetId: usdt.id, status: 'ENABLED' },
          orderBy: { createdAt: 'asc' },
        });

        const markets = {
          ETH: await market(tx, eth.id, ngn.id, ethNetwork.id, configuration.id),
          SOL: await market(tx, sol.id, ngn.id, solNetwork.id, configuration.id),
          USDT: await market(tx, usdt.id, ngn.id, usdtNetwork.id, configuration.id),
        };
        const instruments = {
          ETH: await assetInstrument(tx, eth.id),
          SOL: await assetInstrument(tx, sol.id),
          USDT: await assetInstrument(tx, usdt.id),
          USD: await fiatInstrument(tx, usd.id),
          NGN: await fiatInstrument(tx, ngn.id),
        };
        const coinbase = await tx.pricingProvider.upsert({
          where: { code: 'COINBASE_PUBLIC' },
          update: { type: 'COINBASE_PUBLIC', status: 'ENABLED' },
          create: { code: 'COINBASE_PUBLIC', type: 'COINBASE_PUBLIC' },
        });
        const manual = await tx.pricingProvider.upsert({
          where: { code: 'MANUAL_REVIEWED' },
          update: { type: 'MANUAL', status: 'ENABLED' },
          create: { code: 'MANUAL_REVIEWED', type: 'MANUAL' },
        });
        const pairs = {
          ethUsdt: await pair(
            tx,
            coinbase.id,
            instruments.ETH.id,
            instruments.USDT.id,
            'ETH-USDT',
            8,
            pairMaxAgeSeconds,
          ),
          solUsdt: await pair(
            tx,
            coinbase.id,
            instruments.SOL.id,
            instruments.USDT.id,
            'SOL-USDT',
            8,
            pairMaxAgeSeconds,
          ),
          usdtUsd: await pair(
            tx,
            coinbase.id,
            instruments.USDT.id,
            instruments.USD.id,
            'USDT-USD',
            8,
            pairMaxAgeSeconds,
          ),
          usdNgn: await pair(
            tx,
            manual.id,
            instruments.USD.id,
            instruments.NGN.id,
            'USD-NGN',
            4,
            manualMaxAgeSeconds,
          ),
        };
        await createManualVersion(
          tx,
          pairs.usdNgn.id,
          usdNgnRate,
          actorId,
          reason,
          configuration.id,
          now,
        );

        const routes = {
          ETH: await activateRoute(
            tx,
            markets.ETH,
            [pairs.ethUsdt, pairs.usdtUsd, pairs.usdNgn],
            pairs.usdtUsd,
            configuration.id,
            routeMaxAgeSeconds,
            maxDeviationBps,
            depegToleranceBps,
          ),
          SOL: await activateRoute(
            tx,
            markets.SOL,
            [pairs.solUsdt, pairs.usdtUsd, pairs.usdNgn],
            pairs.usdtUsd,
            configuration.id,
            routeMaxAgeSeconds,
            maxDeviationBps,
            depegToleranceBps,
          ),
          USDT: await activateRoute(
            tx,
            markets.USDT,
            [pairs.usdtUsd, pairs.usdNgn],
            pairs.usdtUsd,
            configuration.id,
            routeMaxAgeSeconds,
            maxDeviationBps,
            depegToleranceBps,
          ),
        };
        for (const configuredMarket of Object.values(markets)) {
          await tx.pricingRefreshJob.upsert({
            where: { marketId: configuredMarket.id },
            update: { refreshIntervalSeconds, status: 'PENDING', nextRefreshAt: now },
            create: { marketId: configuredMarket.id, refreshIntervalSeconds, nextRefreshAt: now },
          });
        }
        return { configurationVersion: configuration.id, markets, routes };
      },
      { maxWait: 30_000, timeout: 120_000 },
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

async function market(
  tx: Tx,
  baseAssetId: string,
  quoteFiatId: string,
  backingId: string,
  configurationVersionId: number,
): Promise<Market> {
  return tx.market.upsert({
    where: { baseAssetId_quoteFiatId: { baseAssetId, quoteFiatId } },
    update: { status: 'ENABLED' },
    create: {
      baseAssetId,
      quoteFiatId,
      defaultBackingAssetNetworkId: backingId,
      minOrderAtomic: 100_000n,
      maxOrderAtomic: 500_000_000n,
      quoteTtlSeconds: 15,
      configurationVersionId,
    },
    select: { id: true },
  });
}

async function assetInstrument(tx: Tx, assetId: string): Promise<Pair> {
  return tx.pricingInstrument.upsert({
    where: { assetId },
    update: {},
    create: { kind: 'ASSET', assetId },
    select: { id: true },
  });
}

async function fiatInstrument(tx: Tx, fiatCurrencyId: string): Promise<Pair> {
  return tx.pricingInstrument.upsert({
    where: { fiatCurrencyId },
    update: {},
    create: { kind: 'FIAT', fiatCurrencyId },
    select: { id: true },
  });
}

async function pair(
  tx: Tx,
  providerId: string,
  baseInstrumentId: string,
  quoteInstrumentId: string,
  providerPairCode: string,
  priceScale: number,
  maxAgeSeconds: number,
): Promise<Pair> {
  return tx.providerPricePair.upsert({
    where: { providerId_providerPairCode: { providerId, providerPairCode } },
    update: { status: 'ENABLED', priceScale, maxAgeSeconds },
    create: {
      providerId,
      baseInstrumentId,
      quoteInstrumentId,
      providerPairCode,
      priceScale,
      maxAgeSeconds,
    },
    select: { id: true },
  });
}

async function createManualVersion(
  tx: Tx,
  providerPricePairId: string,
  rate: string,
  actorId: string,
  reason: string,
  configurationVersionId: number,
  now: Date,
): Promise<void> {
  const latest = await tx.manualPriceVersion.findFirst({
    where: { providerPricePairId },
    orderBy: { version: 'desc' },
  });
  if (latest?.normalizedRate.toFixed() === rate && latest.effectiveUntil === null) return;
  if (latest?.effectiveUntil === null)
    await tx.manualPriceVersion.update({ where: { id: latest.id }, data: { effectiveUntil: now } });
  await tx.manualPriceVersion.create({
    data: {
      providerPricePairId,
      version: (latest?.version ?? 0) + 1,
      rawRate: rate,
      normalizedRate: rate,
      effectiveFrom: now,
      actorId,
      reason,
      configurationVersionId,
    },
  });
}

async function activateRoute(
  tx: Tx,
  configuredMarket: Market,
  legs: readonly Pair[],
  guard: Pair,
  configurationVersionId: number,
  maxAgeSeconds: number,
  maxDeviationBps: number,
  depegToleranceBps: number,
): Promise<string> {
  const version =
    (
      await tx.conversionRoute.aggregate({
        where: { marketId: configuredMarket.id },
        _max: { version: true },
      })
    )._max.version ?? 0;
  const route = await tx.conversionRoute.create({
    data: {
      marketId: configuredMarket.id,
      version: version + 1,
      outputScale: 8,
      maxAgeSeconds,
      maxDeviationBps,
      stablecoinGuardPairId: guard.id,
      stablecoinExpectedRate: '1',
      stablecoinToleranceBps: depegToleranceBps,
      status: 'DISABLED',
      configurationVersionId,
    },
  });
  await tx.conversionRouteLeg.createMany({
    data: legs.map((leg, index) => ({
      id: randomUUID(),
      routeId: route.id,
      sequence: index + 1,
      providerPricePairId: leg.id,
      operation: 'MULTIPLY',
    })),
  });
  await tx.conversionRoute.updateMany({
    where: { marketId: configuredMarket.id, status: 'ENABLED' },
    data: { status: 'DISABLED' },
  });
  await tx.conversionRoute.update({ where: { id: route.id }, data: { status: 'ENABLED' } });
  return route.id;
}

void configure().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
