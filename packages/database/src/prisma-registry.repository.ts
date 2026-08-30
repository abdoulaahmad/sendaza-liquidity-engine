import { Injectable } from '@nestjs/common';
import { AssetView, fromAtomicUnits, MarketView, RegistryRepository } from '../../domain/src';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaRegistryRepository extends RegistryRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listAssets(): Promise<readonly AssetView[]> {
    const assets = await this.prisma.asset.findMany({
      where: {
        status: 'ENABLED',
        assetNetworks: { some: { status: 'ENABLED' } },
      },
      include: {
        assetNetworks: {
          where: { status: 'ENABLED' },
          include: { network: true },
          orderBy: { network: { code: 'asc' } },
        },
      },
      orderBy: { symbol: 'asc' },
    });

    return assets.map((asset) => ({
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      decimals: asset.decimals,
      status: asset.status,
      networks: asset.assetNetworks.map((route) => ({
        id: route.id,
        networkCode: route.network.code,
        networkName: route.network.name,
        tokenStandard: route.tokenStandard,
        contractAddress: route.contractAddress ?? '',
        decimals: route.networkDecimals,
        depositsEnabled: route.depositsEnabled,
        withdrawalsEnabled: route.withdrawalsEnabled,
        status: route.status,
      })),
    }));
  }

  async listMarkets(): Promise<readonly MarketView[]> {
    const markets = await this.prisma.market.findMany({
      where: {
        status: 'ENABLED',
        baseAsset: { status: 'ENABLED' },
        quoteFiat: { status: 'ENABLED' },
        defaultBackingAssetNetwork: { status: 'ENABLED' },
      },
      include: {
        baseAsset: true,
        quoteFiat: true,
      },
      orderBy: [{ baseAsset: { symbol: 'asc' } }, { quoteFiat: { code: 'asc' } }],
    });

    return markets.map((market) => ({
      id: market.id,
      symbol: `${market.baseAsset.symbol}/${market.quoteFiat.code}`,
      baseAsset: market.baseAsset.symbol,
      quoteCurrency: market.quoteFiat.code,
      quoteCurrencyDecimals: market.quoteFiat.decimals,
      defaultAssetNetworkId: market.defaultBackingAssetNetworkId,
      minOrder: fromAtomicUnits(market.minOrderAtomic, market.quoteFiat.decimals),
      maxOrder: fromAtomicUnits(market.maxOrderAtomic, market.quoteFiat.decimals),
      status: market.status,
      configurationVersion: market.configurationVersionId,
    }));
  }
}
