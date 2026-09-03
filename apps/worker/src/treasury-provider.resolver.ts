import {
  ChainBalanceProvider,
  ChainBalanceProviderResolver,
  CustodyProvider,
  CustodyProviderKind,
  CustodyProviderResolver,
} from '../../../packages/domain/src';
import { TreasurySyncConfiguration } from '../../../packages/configuration/src';
import { DeterministicFakeCustodyProvider } from './fake-custody.provider';
import { FireblocksCustodyProvider } from './fireblocks-custody.provider';
import { EvmChainBalanceProvider } from './evm-chain-balance.provider';

export class WorkerCustodyProviderResolver implements CustodyProviderResolver {
  private fireblocks?: FireblocksCustodyProvider;

  constructor(
    private readonly configuration: TreasurySyncConfiguration,
    private readonly fake: DeterministicFakeCustodyProvider,
  ) {}

  resolve(kind: CustodyProviderKind): CustodyProvider {
    if (kind === 'DETERMINISTIC_FAKE') return this.fake;
    if (!this.fireblocks) {
      const credential = this.configuration.fireblocksCredentials();
      this.fireblocks = new FireblocksCustodyProvider(
        credential.apiKey,
        credential.privateKey,
        credential.baseUrl,
        fetch,
        this.configuration.providerTimeoutMs,
      );
    }
    return this.fireblocks;
  }
}

export class WorkerChainBalanceProviderResolver implements ChainBalanceProviderResolver {
  private readonly providers = new Map<string, ChainBalanceProvider>();

  constructor(private readonly configuration: TreasurySyncConfiguration) {}

  resolve(networkCode: string, addressFamily: string): ChainBalanceProvider {
    if (addressFamily !== 'EVM') throw new Error('CHAIN_ADAPTER_UNSUPPORTED');
    const existing = this.providers.get(networkCode);
    if (existing) return existing;
    const url = this.configuration.chainRpcUrls().get(networkCode);
    if (!url) throw new Error('CHAIN_PROVIDER_NOT_CONFIGURED');
    const provider = new EvmChainBalanceProvider(url, fetch, this.configuration.providerTimeoutMs);
    this.providers.set(networkCode, provider);
    return provider;
  }
}
