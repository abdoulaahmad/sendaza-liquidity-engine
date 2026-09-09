import {
  ChainFinalityProvider,
  WithdrawalFinalityClaim,
  WithdrawalFinalityEvidence,
} from '../../../packages/domain/src';

type FetchLike = typeof fetch;
type RpcBody = { result?: unknown; error?: unknown };
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export class EvmChainFinalityProvider implements ChainFinalityProvider {
  constructor(
    private readonly rpcUrls: ReadonlyMap<string, string>,
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 5_000,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async observe(
    claim: WithdrawalFinalityClaim,
    txHash: string,
  ): Promise<WithdrawalFinalityEvidence> {
    if (claim.addressFamily !== 'EVM') throw coded('CHAIN_FINALITY_ADAPTER_UNSUPPORTED');
    const rpcUrl = this.rpcUrls.get(claim.networkCode);
    if (!rpcUrl) throw coded('CHAIN_RPC_NOT_CONFIGURED');

    const [receiptValue, transactionValue, latestValue] = await Promise.all([
      this.rpc(rpcUrl, 'eth_getTransactionReceipt', [txHash]),
      this.rpc(rpcUrl, 'eth_getTransactionByHash', [txHash]),
      this.rpc(rpcUrl, 'eth_blockNumber', []),
    ]);
    if (receiptValue === null || transactionValue === null) throw coded('CHAIN_TX_NOT_FOUND');
    if (!record(receiptValue) || !record(transactionValue) || !hex(latestValue)) {
      throw coded('CHAIN_PROVIDER_RESPONSE_INVALID');
    }

    const receipt = receiptValue;
    const transaction = transactionValue;
    if (!hex(receipt.blockNumber) || !text(receipt.blockHash) || !hex(receipt.status)) {
      throw coded('CHAIN_TX_NOT_FINALIZED');
    }
    const blockNumber = BigInt(receipt.blockNumber);
    const latestBlock = BigInt(latestValue);
    const confirmationCount =
      latestBlock >= blockNumber ? boundedNumber(latestBlock - blockNumber + 1n) : 0;
    const executionSucceeded = BigInt(receipt.status) === 1n;
    const destination = normalizeAddress(claim.destinationAddress);

    let destinationMatches: boolean;
    let amountMatches: boolean;
    let assetMatches: boolean;
    if (claim.contractAddress) {
      const contract = normalizeAddress(claim.contractAddress);
      assetMatches = normalizeOptionalAddress(receipt.to) === contract;
      const transfer = findTransfer(receipt.logs, destination, claim.principalAtomic);
      destinationMatches = transfer.destinationMatches;
      amountMatches = transfer.amountMatches;
    } else {
      assetMatches = true;
      destinationMatches = normalizeOptionalAddress(transaction.to) === destination;
      amountMatches = hex(transaction.value) && BigInt(transaction.value) === claim.principalAtomic;
    }

    return {
      source: 'CHAIN_RPC',
      txHash,
      blockHash: receipt.blockHash,
      blockNumber,
      confirmationCount,
      executionSucceeded,
      destinationMatches,
      amountMatches,
      assetMatches,
      networkMatches: true,
      observedAt: this.clock(),
    };
  }

  private async rpc(url: string, method: string, params: readonly unknown[]): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw coded('CHAIN_PROVIDER_UNAVAILABLE');
      const body = (await response.json()) as RpcBody;
      if (body.error || !Object.prototype.hasOwnProperty.call(body, 'result')) {
        throw coded('CHAIN_PROVIDER_RESPONSE_INVALID');
      }
      return body.result;
    } catch (error: unknown) {
      if (hasCode(error)) throw error;
      throw coded(
        error instanceof Error && error.name === 'AbortError'
          ? 'CHAIN_PROVIDER_TIMEOUT'
          : 'CHAIN_PROVIDER_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function findTransfer(
  logs: unknown,
  destination: string,
  amount: bigint,
): { destinationMatches: boolean; amountMatches: boolean } {
  if (!Array.isArray(logs)) return { destinationMatches: false, amountMatches: false };
  let destinationMatches = false;
  let amountMatches = false;
  for (const value of logs) {
    if (
      !record(value) ||
      !Array.isArray(value.topics) ||
      typeof value.topics[0] !== 'string' ||
      value.topics[0].toLowerCase() !== TRANSFER_TOPIC
    )
      continue;
    const destinationTopic = value.topics[2];
    const data = value.data;
    if (typeof destinationTopic !== 'string' || !hex(data)) continue;
    const to = '0x' + destinationTopic.slice(-40).toLowerCase();
    if (to === destination) {
      destinationMatches = true;
      if (BigInt(data) === amount) amountMatches = true;
    }
  }
  return { destinationMatches, amountMatches };
}
function normalizeAddress(value: string): string {
  const result = normalizeOptionalAddress(value);
  if (!result) throw coded('CHAIN_ADDRESS_INVALID');
  return result;
}
function normalizeOptionalAddress(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(normalized) ? normalized : undefined;
}
function boundedNumber(value: bigint): number {
  return value > 1_000_000n ? 1_000_000 : Number(value);
}
function hex(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 255;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function coded(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
function hasCode(value: unknown): value is { code: string } {
  return typeof value === 'object' && value !== null && 'code' in value;
}
