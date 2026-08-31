import { JsonValue } from './idempotency';

export interface NewOutboxEvent {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: JsonValue;
  readonly correlationId: string;
  readonly maxAttempts?: number;
}

export interface ClaimedOutboxEvent {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: JsonValue;
  readonly correlationId: string;
  readonly occurredAt: Date;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
}

export interface OutboxClaimOptions {
  readonly limit: number;
  readonly leaseSeconds: number;
  readonly now: Date;
  readonly leaseToken: string;
}

export abstract class OutboxRepository {
  abstract enqueue(event: NewOutboxEvent): Promise<string>;
  abstract claimBatch(options: OutboxClaimOptions): Promise<readonly ClaimedOutboxEvent[]>;
  abstract markDelivered(eventId: string, leaseToken: string, deliveredAt: Date): Promise<void>;
  abstract markFailed(
    eventId: string,
    leaseToken: string,
    errorCode: string,
    nextAttemptAt: Date,
    failedAt: Date,
  ): Promise<'RETRY_SCHEDULED' | 'QUARANTINED'>;
}

export abstract class OutboxPublisher {
  abstract publish(event: ClaimedOutboxEvent): Promise<void>;
}

export interface OutboxBatchResult {
  readonly claimed: number;
  readonly delivered: number;
  readonly retryScheduled: number;
  readonly quarantined: number;
}

export class OutboxDeliveryService {
  constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: OutboxPublisher,
    private readonly batchLimit = 25,
    private readonly leaseSeconds = 30,
  ) {}

  async processBatch(now: Date, leaseToken: string): Promise<OutboxBatchResult> {
    const events = await this.repository.claimBatch({
      limit: this.batchLimit,
      leaseSeconds: this.leaseSeconds,
      now,
      leaseToken,
    });
    let delivered = 0;
    let retryScheduled = 0;
    let quarantined = 0;
    for (const event of events) {
      try {
        await this.publisher.publish(event);
        await this.repository.markDelivered(event.id, event.leaseToken, now);
        delivered += 1;
      } catch (error: unknown) {
        const result = await this.repository.markFailed(
          event.id,
          event.leaseToken,
          this.safeErrorCode(error),
          calculateOutboxRetryAt(now, event.attemptCount),
          now,
        );
        if (result === 'QUARANTINED') quarantined += 1;
        else retryScheduled += 1;
      }
    }
    return { claimed: events.length, delivered, retryScheduled, quarantined };
  }

  private safeErrorCode(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string' && /^[A-Z0-9_:-]{1,100}$/.test(code)) return code;
    }
    return 'DELIVERY_FAILED';
  }
}

export function calculateOutboxRetryAt(
  failedAt: Date,
  attemptCount: number,
  baseSeconds = 5,
  maximumSeconds = 300,
): Date {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) throw new Error('INVALID_ATTEMPT_COUNT');
  const delaySeconds = Math.min(baseSeconds * 2 ** (attemptCount - 1), maximumSeconds);
  return new Date(failedAt.getTime() + delaySeconds * 1000);
}
