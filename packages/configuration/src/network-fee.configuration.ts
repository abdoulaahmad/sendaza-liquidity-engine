import { Injectable } from '@nestjs/common';

function integer(name: string, fallback: string, minimum: number, maximum: number): number {
  const raw = process.env[name] ?? fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number.parseInt(raw, 10);
  if (value < minimum || value > maximum) throw new Error(`${name} is outside its safe range`);
  return value;
}

function atomic(name: string, fallback: string): bigint {
  const raw = process.env[name] ?? fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${name} must be positive atomic units`);
  return BigInt(raw);
}

@Injectable()
export class NetworkFeeConfiguration {
  readonly pollIntervalMs = integer('SLE_NETWORK_FEE_POLL_INTERVAL_MS', '1000', 100, 60_000);
  readonly batchSize = integer('SLE_NETWORK_FEE_BATCH_SIZE', '10', 1, 100);
  readonly leaseSeconds = integer('SLE_NETWORK_FEE_LEASE_SECONDS', '30', 1, 300);
  readonly retrySeconds = integer('SLE_NETWORK_FEE_RETRY_SECONDS', '10', 1, 300);
  readonly fakeProviderFeeAtomic = atomic('SLE_FAKE_PROVIDER_FEE_ATOMIC', '100000');
  readonly fakeRpcFeeAtomic = atomic('SLE_FAKE_RPC_FEE_ATOMIC', '102000');
}
