import { Injectable } from '@nestjs/common';

function boundedInteger(name: string, fallback: string, minimum: number, maximum: number): number {
  const raw = process.env[name] ?? fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number.parseInt(raw, 10);
  if (value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

@Injectable()
export class PricingRefreshConfiguration {
  readonly pollIntervalMs = boundedInteger(
    'SLE_PRICING_POLL_INTERVAL_MS',
    '1000',
    100,
    60_000,
  );
  readonly batchSize = boundedInteger('SLE_PRICING_BATCH_SIZE', '10', 1, 100);
  readonly leaseSeconds = boundedInteger('SLE_PRICING_LEASE_SECONDS', '30', 1, 300);
  readonly providerTimeoutMs = boundedInteger(
    'SLE_PRICE_PROVIDER_TIMEOUT_MS',
    '3000',
    100,
    30_000,
  );
}
