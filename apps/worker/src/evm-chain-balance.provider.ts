import { ChainBalanceProvider, TreasurySyncTarget } from '../../../packages/domain/src';

type FetchLike = typeof fetch;

export class EvmChainBalanceProvider implements ChainBalanceProvider {
  constructor(
    private readonly rpcUrl: string,
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 5_000,
  ) {}

  async getConfirmedBalanceAtomic(target: TreasurySyncTarget): Promise<bigint> {
    const method = target.contractAddress ? 'eth_call' : 'eth_getBalance';
    const params = target.contractAddress
      ? [
          { to: target.contractAddress, data: `0x70a08231${encodeAddress(target.publicAddress)}` },
          'latest',
        ]
      : [target.publicAddress, 'latest'];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('CHAIN_PROVIDER_UNAVAILABLE');
      const body = (await response.json()) as { result?: unknown; error?: unknown };
      if (body.error || typeof body.result !== 'string' || !/^0x[0-9a-f]+$/i.test(body.result)) {
        throw new Error('CHAIN_PROVIDER_RESPONSE_INVALID');
      }
      return BigInt(body.result);
    } catch (error: unknown) {
      if (error instanceof Error && /^CHAIN_/.test(error.message)) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('CHAIN_PROVIDER_TIMEOUT', { cause: error });
      }
      throw new Error('CHAIN_PROVIDER_UNAVAILABLE', { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}

function encodeAddress(address: string): string {
  const normalized = address.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw new Error('CHAIN_ADDRESS_INVALID');
  return normalized.padStart(64, '0');
}
