import { AssetView, MarketView } from './registry.types';

export class RegistryIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryIntegrityError';
  }
}

export function assertRegistryIntegrity(
  assets: readonly AssetView[],
  markets: readonly MarketView[],
): void {
  assertUnique(
    assets.map(({ symbol }) => symbol),
    'asset symbol',
  );

  const routes = assets.flatMap((asset) =>
    asset.networks.map((network) => ({
      id: network.id,
      key: `${asset.symbol}:${network.networkCode}`,
      assetSymbol: asset.symbol,
    })),
  );

  assertUnique(
    routes.map(({ id }) => id),
    'asset-network id',
  );
  assertUnique(
    routes.map(({ key }) => key),
    'asset-network route',
  );
  assertUnique(
    markets.map(({ symbol }) => symbol),
    'market symbol',
  );

  const routeById = new Map(routes.map((route) => [route.id, route]));
  for (const market of markets) {
    const route = routeById.get(market.defaultAssetNetworkId);
    if (!route) {
      throw new RegistryIntegrityError(
        `Market ${market.symbol} references an unknown default asset-network`,
      );
    }
    if (route.assetSymbol !== market.baseAsset) {
      throw new RegistryIntegrityError(
        `Market ${market.symbol} default route belongs to ${route.assetSymbol}`,
      );
    }
  }
}

function assertUnique(values: readonly string[], field: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new RegistryIntegrityError(`Duplicate ${field}: ${value}`);
    }
    seen.add(value);
  }
}
