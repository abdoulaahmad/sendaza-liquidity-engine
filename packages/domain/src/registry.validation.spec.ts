import { AssetView, MarketView } from './registry.types';
import { assertRegistryIntegrity, RegistryIntegrityError } from './registry.validation';

const asset = (routeId: string, networkCode: string): AssetView => ({
  id: 'asset_usdt',
  symbol: 'USDT',
  name: 'Tether USD',
  decimals: 6,
  status: 'ENABLED',
  networks: [
    {
      id: routeId,
      networkCode,
      networkName: networkCode,
      tokenStandard: 'TOKEN',
      contractAddress: 'token-address',
      decimals: 6,
      depositsEnabled: true,
      withdrawalsEnabled: true,
      status: 'ENABLED',
    },
  ],
});

const market = (routeId: string): MarketView => ({
  id: 'market_usdt_ngn',
  symbol: 'USDT/NGN',
  baseAsset: 'USDT',
  quoteCurrency: 'NGN',
  quoteCurrencyDecimals: 2,
  defaultAssetNetworkId: routeId,
  minOrder: '1000.00',
  maxOrder: '5000000.00',
  status: 'ENABLED',
  configurationVersion: 1,
});

describe('registry integrity', () => {
  it('accepts distinct routes for the same asset', () => {
    const usdt = asset('usdt-ethereum', 'ETHEREUM');
    const withSecondRoute: AssetView = {
      ...usdt,
      networks: [...usdt.networks, asset('usdt-solana', 'SOLANA').networks[0]!],
    };
    expect(() =>
      assertRegistryIntegrity([withSecondRoute], [market('usdt-ethereum')]),
    ).not.toThrow();
  });

  it('rejects duplicate asset-network routes', () => {
    const usdt = asset('route-one', 'ETHEREUM');
    const duplicate: AssetView = {
      ...usdt,
      networks: [...usdt.networks, asset('route-two', 'ETHEREUM').networks[0]!],
    };
    expect(() => assertRegistryIntegrity([duplicate], [])).toThrow(
      new RegistryIntegrityError('Duplicate asset-network route: USDT:ETHEREUM'),
    );
  });

  it('rejects markets with an unknown default route', () => {
    expect(() =>
      assertRegistryIntegrity([asset('usdt-ethereum', 'ETHEREUM')], [market('missing')]),
    ).toThrow('references an unknown default asset-network');
  });
});
