import { createHash, randomUUID, sign } from 'node:crypto';
import {
  CustodyBalanceEvidence,
  CustodyProvider,
  TreasurySyncTarget,
} from '../../../packages/domain/src';

type FetchLike = typeof fetch;
type VaultAsset = {
  total?: unknown;
  available?: unknown;
  pending?: unknown;
  frozen?: unknown;
  lockedAmount?: unknown;
  blockHash?: unknown;
};
type AddressPage = { addresses?: unknown };

export class FireblocksProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'FireblocksProviderError';
  }
}

export class FireblocksCustodyProvider implements CustodyProvider {
  constructor(
    private readonly apiKey: string,
    private readonly apiPrivateKey: string,
    private readonly baseUrl: string,
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 5_000,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!apiKey || !apiPrivateKey) throw new FireblocksProviderError('CUSTODY_CREDENTIALS_MISSING');
  }

  async getWalletBalance(target: TreasurySyncTarget): Promise<CustodyBalanceEvidence> {
    const root = `/v1/vault/accounts/${encodeURIComponent(target.providerVaultId)}/${encodeURIComponent(target.providerAssetId)}`;
    const [asset, addressPage] = await Promise.all([
      this.getJson<VaultAsset>(root),
      this.getJson<AddressPage>(`${root}/addresses_paginated?limit=50`),
    ]);
    const addresses = Array.isArray(addressPage.addresses)
      ? addressPage.addresses.map(parseAddress)
      : invalidResponse();
    return {
      total: requiredDecimal(asset.total),
      available: requiredDecimal(asset.available),
      pending: requiredDecimal(asset.pending),
      frozen: requiredDecimal(asset.frozen),
      locked: requiredDecimal(asset.lockedAmount),
      addresses,
      observedAt: this.clock(),
      ...(typeof asset.blockHash === 'string' ? { providerReference: asset.blockHash } : {}),
    };
  }

  private async getJson<T>(uri: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}${uri}`, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey,
          Authorization: `Bearer ${this.token(uri)}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw new FireblocksProviderError('CUSTODY_CREDENTIALS_INVALID');
      }
      if (!response.ok) throw new FireblocksProviderError('CUSTODY_PROVIDER_UNAVAILABLE');
      return (await response.json()) as T;
    } catch (error: unknown) {
      if (error instanceof FireblocksProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new FireblocksProviderError('CUSTODY_PROVIDER_TIMEOUT');
      }
      throw new FireblocksProviderError('CUSTODY_PROVIDER_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  private token(uri: string): string {
    const issuedAt = Math.floor(this.clock().getTime() / 1000);
    const header = encode({ alg: 'RS256', typ: 'JWT' });
    const payload = encode({
      uri,
      nonce: randomUUID(),
      iat: issuedAt,
      exp: issuedAt + 29,
      sub: this.apiKey,
      bodyHash: createHash('sha256').update('').digest('hex'),
    });
    const unsigned = `${header}.${payload}`;
    return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), this.apiPrivateKey).toString('base64url')}`;
  }
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function requiredDecimal(value: unknown): string {
  if (typeof value !== 'string') return invalidResponse();
  return value;
}

function parseAddress(value: unknown): { address: string; tag?: string } {
  if (typeof value !== 'object' || value === null || !('address' in value))
    return invalidResponse();
  const address = (value as { address?: unknown }).address;
  const tag = (value as { tag?: unknown }).tag;
  if (typeof address !== 'string') return invalidResponse();
  return { address, ...(typeof tag === 'string' && tag.length > 0 ? { tag } : {}) };
}

function invalidResponse(): never {
  throw new FireblocksProviderError('CUSTODY_PROVIDER_RESPONSE_INVALID');
}
