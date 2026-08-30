import { RegistryService, SeededRegistryRepository } from '../../../packages/domain/src';
import { RegistryController } from './registry.controller';

describe('RegistryController', () => {
  const controller = new RegistryController(new RegistryService(new SeededRegistryRepository()));

  it('discovers one asset through two distinct network routes', () => {
    const response = controller.assets();
    expect(response.data[0]?.networks.map((network) => network.networkCode)).toEqual([
      'ETHEREUM',
      'SOLANA',
    ]);
  });

  it('returns configured markets without executable prices', () => {
    expect(controller.markets().data[0]).toMatchObject({
      symbol: 'USDT/NGN',
      configurationVersion: 1,
    });
    expect(controller.markets().data[0]).not.toHaveProperty('price');
  });
});
