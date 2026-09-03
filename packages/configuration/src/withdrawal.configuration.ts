import { Injectable } from '@nestjs/common';

function integer(name: string, fallback: string, minimum: number, maximum: number): number {
  const raw = process.env[name] ?? fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number.parseInt(raw, 10);
  if (value < minimum || value > maximum) throw new Error(`${name} is outside its safe range`);
  return value;
}

@Injectable()
export class WithdrawalConfiguration {
  readonly submissionPollIntervalMs = integer(
    'SLE_WITHDRAWAL_SUBMISSION_POLL_INTERVAL_MS',
    '1000',
    100,
    60_000,
  );
  readonly submissionBatchSize = integer('SLE_WITHDRAWAL_SUBMISSION_BATCH_SIZE', '10', 1, 100);
  readonly submissionLeaseSeconds = integer(
    'SLE_WITHDRAWAL_SUBMISSION_LEASE_SECONDS',
    '30',
    1,
    300,
  );
  readonly recoveryPollIntervalMs = integer(
    'SLE_WITHDRAWAL_RECOVERY_POLL_INTERVAL_MS',
    '5000',
    100,
    60_000,
  );
  readonly recoveryBatchSize = integer('SLE_WITHDRAWAL_RECOVERY_BATCH_SIZE', '10', 1, 100);
}
