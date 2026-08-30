import { RegistryService, SeededRegistryRepository } from '../../../packages/domain/src';
import { RegistryController } from './registry.controller';

describe('RegistryController', () => {
  const controller = new RegistryController(new RegistryService(new SeededRegistryRepository()));

  it('discovers one asset through two distinct network routes', async () => {
    const response = await controller.assets();
    expect(response.data[0]?.networks.map((network) => network.networkCode)).toEqual([
      'ETHEREUM',
      'SOLANA',
    ]);
  });

  it('returns configured markets without executable prices', async () => {
    const response = await controller.markets();
    expect(response.data[0]).toMatchObject({
      symbol: 'USDT/NGN',
      configurationVersion: 1,
    });
    expect(response.data[0]).not.toHaveProperty('price');
  });
});
