import { Injectable } from '@nestjs/common';
import { AssetView, MarketView } from './registry.types';
import { assertRegistryIntegrity } from './registry.validation';

export abstract class RegistryRepository {
  abstract listAssets(): readonly AssetView[];
  abstract listMarkets(): readonly MarketView[];
}

@Injectable()
export class SeededRegistryRepository extends RegistryRepository {
  constructor() {
    super();
    assertRegistryIntegrity(ASSETS, MARKETS);
  }

  listAssets(): readonly AssetView[] {
    return ASSETS;
  }

  listMarkets(): readonly MarketView[] {
    return MARKETS;
  }
}

const ASSETS: readonly AssetView[] = Object.freeze([
  Object.freeze({
    id: 'asset_usdt',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    status: 'ENABLED',
    networks: Object.freeze([
      Object.freeze({
        id: 'asset_network_usdt_ethereum',
        networkCode: 'ETHEREUM',
        networkName: 'Ethereum',
        tokenStandard: 'ERC20',
        contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        decimals: 6,
        depositsEnabled: true,
        withdrawalsEnabled: true,
        status: 'ENABLED',
      }),
      Object.freeze({
        id: 'asset_network_usdt_solana',
        networkCode: 'SOLANA',
        networkName: 'Solana',
        tokenStandard: 'SPL',
        contractAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        decimals: 6,
        depositsEnabled: true,
        withdrawalsEnabled: true,
        status: 'ENABLED',
      }),
    ]),
  }),
]);

const MARKETS: readonly MarketView[] = Object.freeze([
  Object.freeze({
    id: 'market_usdt_ngn',
    symbol: 'USDT/NGN',
    baseAsset: 'USDT',
    quoteCurrency: 'NGN',
    quoteCurrencyDecimals: 2,
    defaultAssetNetworkId: 'asset_network_usdt_ethereum',
    minOrder: '1000.00',
    maxOrder: '5000000.00',
    status: 'ENABLED',
    configurationVersion: 1,
  }),
]);
