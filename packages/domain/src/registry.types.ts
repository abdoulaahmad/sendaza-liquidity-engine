export type RegistryStatus = 'ENABLED' | 'DISABLED';

export interface AssetNetworkView {
  readonly id: string;
  readonly networkCode: string;
  readonly networkName: string;
  readonly tokenStandard: string;
  readonly contractAddress: string;
  readonly decimals: number;
  readonly depositsEnabled: boolean;
  readonly withdrawalsEnabled: boolean;
  readonly status: RegistryStatus;
}

export interface AssetView {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly status: RegistryStatus;
  readonly networks: readonly AssetNetworkView[];
}

export interface MarketView {
  readonly id: string;
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteCurrency: string;
  readonly quoteCurrencyDecimals: number;
  readonly defaultAssetNetworkId: string;
  readonly minOrder: string;
  readonly maxOrder: string;
  readonly status: RegistryStatus;
  readonly configurationVersion: number;
}
