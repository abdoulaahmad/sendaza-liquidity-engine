import { Injectable } from '@nestjs/common';

function integer(name: string, fallback: string, minimum: number, maximum: number): number {
  const raw = process.env[name] ?? fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number.parseInt(raw, 10);
  if (value < minimum || value > maximum)
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  return value;
}

@Injectable()
export class TreasurySyncConfiguration {
  readonly pollIntervalMs = integer('SLE_TREASURY_POLL_INTERVAL_MS', '1000', 100, 60_000);
  readonly batchSize = integer('SLE_TREASURY_BATCH_SIZE', '10', 1, 100);
  readonly leaseSeconds = integer('SLE_TREASURY_LEASE_SECONDS', '30', 1, 300);
  readonly refreshSeconds = integer('SLE_TREASURY_REFRESH_SECONDS', '30', 5, 3600);
  readonly retrySeconds = integer('SLE_TREASURY_RETRY_SECONDS', '15', 1, 3600);
  readonly providerTimeoutMs = integer('SLE_CUSTODY_PROVIDER_TIMEOUT_MS', '5000', 100, 30_000);

  fireblocksCredentials(): { apiKey: string; privateKey: string; baseUrl: string } {
    const apiKey = process.env.FIREBLOCKS_API_KEY;
    const privateKey = process.env.FIREBLOCKS_API_PRIVATE_KEY?.replaceAll('\\n', '\n');
    const baseUrl = process.env.FIREBLOCKS_BASE_URL ?? 'https://sandbox-api.fireblocks.io';
    if (!apiKey || !privateKey) throw new Error('CUSTODY_CREDENTIALS_MISSING');
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.fireblocks.io')) {
      throw new Error('FIREBLOCKS_BASE_URL_INVALID');
    }
    return { apiKey, privateKey, baseUrl: baseUrl.replace(/\/$/, '') };
  }

  chainRpcUrls(): ReadonlyMap<string, string> {
    const raw = process.env.SLE_CHAIN_RPC_URLS_JSON ?? '{}';
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('SLE_CHAIN_RPC_URLS_JSON_INVALID');
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('SLE_CHAIN_RPC_URLS_JSON_INVALID');
    }
    const entries = Object.entries(value);
    for (const [network, url] of entries) {
      if (!/^[A-Z0-9_-]{1,30}$/.test(network) || typeof url !== 'string') {
        throw new Error('SLE_CHAIN_RPC_URLS_JSON_INVALID');
      }
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') throw new Error('SLE_CHAIN_RPC_URLS_JSON_INVALID');
    }
    return new Map(entries as [string, string][]);
  }
}
