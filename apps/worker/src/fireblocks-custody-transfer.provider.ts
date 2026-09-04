import { createHash, randomUUID, sign } from 'node:crypto';
import { fromAtomicUnits } from '../../../packages/domain/src';
import {
  CustodyTransferOutcome,
  CustodyTransferProvider,
  CustodyTransferRequest,
} from '../../../packages/domain/src';

type FetchLike = typeof fetch;
type TransactionResponse = { id?: unknown; status?: unknown };

export class FireblocksTransferProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FireblocksTransferProviderError';
  }
}

const REJECTED_STATUSES = new Set(['FAILED', 'REJECTED', 'CANCELLED', 'BLOCKED']);
const ACCEPTED_STATUSES = new Set([
  'SUBMITTED',
  'PENDING_SIGNATURE',
  'QUEUED',
  'PENDING_AUTHORIZATION',
  'BROADCASTING',
  'CONFIRMING',
  'COMPLETED',
]);

export class FireblocksCustodyTransferProvider implements CustodyTransferProvider {
  constructor(
    private readonly apiKey: string,
    private readonly apiPrivateKey: string,
    private readonly baseUrl: string,
    private readonly vaultAccountId: string,
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 5_000,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!apiKey || !apiPrivateKey) {
      throw new FireblocksTransferProviderError('CUSTODY_CREDENTIALS_MISSING');
    }
  }

  async createTransfer(request: CustodyTransferRequest): Promise<CustodyTransferOutcome> {
    const body = JSON.stringify({
      // externalTxId is Fireblocks' own idempotency key: resubmitting the same
      // withdrawal ID never creates a second on-chain transfer.
      externalTxId: request.externalTxId,
      assetId: request.assetNetworkId,
      source: { type: 'VAULT_ACCOUNT', id: this.vaultAccountId },
      destination: {
        type: 'ONE_TIME_ADDRESS',
        oneTimeAddress: { address: request.destinationAddress },
      },
      amount: fromAtomicUnits(request.amountAtomic, request.assetDecimals),
    });
    return this.post('/v1/transactions', body);
  }

  async findTransferByExternalTxId(externalTxId: string): Promise<CustodyTransferOutcome> {
    return this.get(`/v1/transactions/external-tx-id/${encodeURIComponent(externalTxId)}`);
  }

  private async post(uri: string, body: string): Promise<CustodyTransferOutcome> {
    return this.request('POST', uri, body);
  }

  private async get(uri: string): Promise<CustodyTransferOutcome> {
    return this.request('GET', uri, '');
  }

  private async request(
    method: 'GET' | 'POST',
    uri: string,
    body: string,
  ): Promise<CustodyTransferOutcome> {
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
      if (response.status === 404) return { kind: 'UNKNOWN' };
      if (response.status === 401 || response.status === 403) {
        throw new FireblocksTransferProviderError('CUSTODY_CREDENTIALS_INVALID');
      }
      if (!response.ok) return { kind: 'UNKNOWN' };
      const parsed = (await response.json()) as TransactionResponse;
      return classify(parsed);
    } catch (error: unknown) {
      if (error instanceof FireblocksTransferProviderError) throw error;
      // A network error or timeout during submission is not proof of
      // failure; the caller must resolve it via findTransferByExternalTxId.
      return { kind: 'UNKNOWN' };
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

function classify(response: TransactionResponse): CustodyTransferOutcome {
  const id = typeof response.id === 'string' ? response.id : undefined;
  const status = typeof response.status === 'string' ? response.status : undefined;
  if (status && REJECTED_STATUSES.has(status)) {
    return { kind: 'REJECTED', reasonCode: status };
  }
  if (id && status && ACCEPTED_STATUSES.has(status)) {
    return { kind: 'ACCEPTED', providerTransferId: id };
  }
  return { kind: 'UNKNOWN' };
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
