import { createHash, randomUUID, sign } from 'node:crypto';
import {
  CustodyFinalityProvider,
  CustodyTransferOutcome,
  CustodyTransferProvider,
  CustodyTransferRequest,
  WithdrawalFinalityEvidence,
  fromAtomicUnits,
} from '../../../packages/domain/src';

type FetchLike = typeof fetch;
type TransactionResponse = {
  id?: unknown;
  status?: unknown;
  txHash?: unknown;
  numOfConfirmations?: unknown;
  externalTxId?: unknown;
  replacedTxHash?: unknown;
  blockInfo?: unknown;
};

export class FireblocksTransferProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FireblocksTransferProviderError';
  }
}

const TERMINAL_FAILURE_STATUSES = new Set(['FAILED', 'REJECTED', 'CANCELLED', 'BLOCKED']);
const ACCEPTED_STATUSES = new Set([
  'SUBMITTED',
  'PENDING_SIGNATURE',
  'QUEUED',
  'PENDING_AUTHORIZATION',
  'BROADCASTING',
  'CONFIRMING',
  'COMPLETED',
]);

export class FireblocksCustodyTransferProvider
  implements CustodyTransferProvider, CustodyFinalityProvider
{
  constructor(
    private readonly apiKey: string,
    private readonly apiPrivateKey: string,
    private readonly baseUrl: string,
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 5_000,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!apiKey || !apiPrivateKey)
      throw new FireblocksTransferProviderError('CUSTODY_CREDENTIALS_MISSING');
  }

  async createTransfer(request: CustodyTransferRequest): Promise<CustodyTransferOutcome> {
    const body = JSON.stringify({
      externalTxId: request.externalTxId,
      assetId: request.providerAssetId,
      source: { type: 'VAULT_ACCOUNT', id: request.providerVaultId },
      destination: {
        type: 'ONE_TIME_ADDRESS',
        oneTimeAddress: { address: request.destinationAddress },
      },
      amount: fromAtomicUnits(request.amountAtomic, request.assetDecimals),
    });
    return this.submissionRequest('POST', '/v1/transactions', body);
  }

  async findTransferByExternalTxId(externalTxId: string): Promise<CustodyTransferOutcome> {
    const response = await this.request(
      'GET',
      `/v1/transactions/external_tx_id/${encodeURIComponent(externalTxId)}`,
      '',
    );
    return response ? classify(response) : { kind: 'UNKNOWN' };
  }

  async getTransfer(providerTransferId: string): Promise<WithdrawalFinalityEvidence | null> {
    const response = await this.request(
      'GET',
      `/v1/transactions/${encodeURIComponent(providerTransferId)}`,
      '',
    );
    if (!response) return null;
    const status = text(response.status, 100);
    if (!status) throw new FireblocksTransferProviderError('CUSTODY_RESPONSE_INVALID');
    const blockInfo = record(response.blockInfo) ? response.blockInfo : undefined;
    const txHash = text(response.txHash, 255) ?? text(blockInfo?.txHash, 255);
    const blockHash = text(blockInfo?.blockHash, 255);
    const blockNumber = unsignedBigint(blockInfo?.blockHeight ?? blockInfo?.blockNumber);
    const confirmationCount = unsignedInteger(response.numOfConfirmations, 1_000_000);
    return {
      source: 'FIREBLOCKS_POLL',
      providerStatus: status,
      ...(text(response.id, 150) ? { providerTransferId: text(response.id, 150) } : {}),
      ...(text(response.externalTxId, 150)
        ? { externalTxId: text(response.externalTxId, 150) }
        : {}),
      ...(text(response.replacedTxHash, 255)
        ? { replacedTxHash: text(response.replacedTxHash, 255) }
        : {}),
      ...(txHash ? { txHash } : {}),
      ...(blockHash ? { blockHash } : {}),
      ...(blockNumber === undefined ? {} : { blockNumber }),
      ...(confirmationCount === undefined ? {} : { confirmationCount }),
      observedAt: this.clock(),
    };
  }

  private async submissionRequest(
    method: 'GET' | 'POST',
    uri: string,
    body: string,
  ): Promise<CustodyTransferOutcome> {
    try {
      return classify(await this.request(method, uri, body));
    } catch (error: unknown) {
      if (
        error instanceof FireblocksTransferProviderError &&
        ['CUSTODY_PROVIDER_TIMEOUT', 'CUSTODY_PROVIDER_UNAVAILABLE'].includes(error.code)
      ) {
        return { kind: 'UNKNOWN' };
      }
      throw error;
    }
  }
  private async request(
    method: 'GET' | 'POST',
    uri: string,
    body: string,
  ): Promise<TransactionResponse | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}${uri}`, {
        method,
        headers: {
          'X-API-Key': this.apiKey,
          Authorization: `Bearer ${this.token(uri, body)}`,
          Accept: 'application/json',
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body } : {}),
        signal: controller.signal,
      });
      if (response.status === 404) return null;
      if (response.status === 401 || response.status === 403)
        throw new FireblocksTransferProviderError('CUSTODY_CREDENTIALS_INVALID');
      if (!response.ok) throw new FireblocksTransferProviderError('CUSTODY_PROVIDER_UNAVAILABLE');
      const parsed = (await response.json()) as unknown;
      if (!record(parsed)) throw new FireblocksTransferProviderError('CUSTODY_RESPONSE_INVALID');
      return parsed;
    } catch (error: unknown) {
      if (error instanceof FireblocksTransferProviderError) throw error;
      throw new FireblocksTransferProviderError(
        error instanceof Error && error.name === 'AbortError'
          ? 'CUSTODY_PROVIDER_TIMEOUT'
          : 'CUSTODY_PROVIDER_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private token(uri: string, body: string): string {
    const issuedAt = Math.floor(this.clock().getTime() / 1000);
    const header = encode({ alg: 'RS256', typ: 'JWT' });
    const payload = encode({
      uri,
      nonce: randomUUID(),
      iat: issuedAt,
      exp: issuedAt + 29,
      sub: this.apiKey,
      bodyHash: createHash('sha256').update(body).digest('hex'),
    });
    const unsigned = `${header}.${payload}`;
    return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), this.apiPrivateKey).toString('base64url')}`;
  }
}

function classify(response: TransactionResponse | null): CustodyTransferOutcome {
  if (!response) return { kind: 'UNKNOWN' };
  const id = text(response.id, 150);
  const status = text(response.status, 100);
  if (status && TERMINAL_FAILURE_STATUSES.has(status))
    return { kind: 'TERMINAL_FAILURE', reasonCode: status };
  if (id && status && ACCEPTED_STATUSES.has(status))
    return { kind: 'ACCEPTED', providerTransferId: id };
  return { kind: 'UNKNOWN' };
}
function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
function text(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    ? value
    : undefined;
}
function unsignedBigint(value: unknown): bigint | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : undefined;
}
function unsignedInteger(value: unknown, maximum: number): number | undefined {
  const parsed =
    typeof value === 'number' && Number.isInteger(value)
      ? value
      : typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
        ? Number(value)
        : undefined;
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum
    ? parsed
    : undefined;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
