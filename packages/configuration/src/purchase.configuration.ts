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
export class PurchaseConfiguration {
  readonly reservationTtlSeconds = integer('SLE_PURCHASE_RESERVATION_TTL_SECONDS', '60', 5, 3600);
  readonly timeoutPollIntervalMs = integer(
    'SLE_PURCHASE_TIMEOUT_POLL_INTERVAL_MS',
    '1000',
    100,
    60000,
  );
  readonly timeoutBatchSize = integer('SLE_PURCHASE_TIMEOUT_BATCH_SIZE', '25', 1, 100);
  readonly timeoutLeaseSeconds = integer('SLE_PURCHASE_TIMEOUT_LEASE_SECONDS', '30', 1, 300);
}
