import { PrismaRegistryRepository } from './prisma-registry.repository';
import { PrismaService } from './prisma.service';

describe('PrismaRegistryRepository', () => {
  const assetFindMany = jest.fn();
  const marketFindMany = jest.fn();
  const prisma = {
    asset: { findMany: assetFindMany },
    market: { findMany: marketFindMany },
  } as unknown as PrismaService;
  const repository = new PrismaRegistryRepository(prisma);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('maps one asset into distinct network routes', async () => {
    assetFindMany.mockResolvedValue([
      {
        id: 'asset-usdt',
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
        status: 'ENABLED',
        assetNetworks: [
          {
            id: 'usdt-ethereum',
            tokenStandard: 'ERC20',
            contractAddress: '0xtoken',
            networkDecimals: 6,
            depositsEnabled: true,
            withdrawalsEnabled: true,
            status: 'ENABLED',
            network: { code: 'ETHEREUM', name: 'Ethereum' },
          },
          {
            id: 'usdt-solana',
            tokenStandard: 'SPL',
            contractAddress: 'solana-token',
            networkDecimals: 6,
            depositsEnabled: true,
            withdrawalsEnabled: true,
            status: 'ENABLED',
            network: { code: 'SOLANA', name: 'Solana' },
          },
        ],
      },
    ]);

    const assets = await repository.listAssets();

    expect(assets[0]?.networks.map(({ networkCode }) => networkCode)).toEqual([
      'ETHEREUM',
      'SOLANA',
    ]);
  });

  it('formats market limits using fiat precision and bigint values', async () => {
    marketFindMany.mockResolvedValue([
      {
        id: 'market-usdt-ngn',
        defaultBackingAssetNetworkId: 'usdt-ethereum',
        minOrderAtomic: 100_001n,
        maxOrderAtomic: 500_000_000n,
        status: 'ENABLED',
        configurationVersionId: 4,
        baseAsset: { symbol: 'USDT' },
        quoteFiat: { code: 'NGN', decimals: 2 },
      },
    ]);

    const markets = await repository.listMarkets();

    expect(markets[0]).toMatchObject({
      symbol: 'USDT/NGN',
      minOrder: '1000.01',
      maxOrder: '5000000.00',
      configurationVersion: 4,
    });
  });
});
