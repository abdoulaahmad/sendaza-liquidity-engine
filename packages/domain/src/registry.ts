import { Injectable, Module } from '@nestjs/common';

export type RegistryStatus = 'ENABLED' | 'DISABLED';
export interface AssetNetworkView {
  id: string;
  networkCode: string;
  networkName: string;
  tokenStandard: string;
  contractAddress: string;
  decimals: number;
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
  status: RegistryStatus;
}
export interface AssetView {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  status: RegistryStatus;
  networks: AssetNetworkView[];
}
export interface MarketView {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteCurrency: string;
  quoteCurrencyDecimals: number;
  defaultAssetNetworkId: string;
  minOrder: string;
  maxOrder: string;
  status: RegistryStatus;
  configurationVersion: number;
}

@Injectable()
export class RegistryService {
  listAssets(): AssetView[] {
    return ASSETS;
  }
  listMarkets(): MarketView[] {
    return MARKETS;
  }
}

@Module({ providers: [RegistryService], exports: [RegistryService] })
export class RegistryModule {}

const ASSETS: AssetView[] = [
  {
    id: 'asset_usdt',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    status: 'ENABLED',
    networks: [
      {
        id: 'asset_network_usdt_ethereum',
        networkCode: 'ETHEREUM',
        networkName: 'Ethereum',
        tokenStandard: 'ERC20',
        contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        decimals: 6,
        depositsEnabled: true,
        withdrawalsEnabled: true,
        status: 'ENABLED',
      },
      {
        id: 'asset_network_usdt_solana',
        networkCode: 'SOLANA',
        networkName: 'Solana',
        tokenStandard: 'SPL',
        contractAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        decimals: 6,
        depositsEnabled: true,
        withdrawalsEnabled: true,
        status: 'ENABLED',
      },
    ],
  },
];

const MARKETS: MarketView[] = [
  {
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
  },
];
