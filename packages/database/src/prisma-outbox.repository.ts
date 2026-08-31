import { Injectable } from '@nestjs/common';
import {
  ClaimedOutboxEvent,
  JsonValue,
  NewOutboxEvent,
  OutboxClaimOptions,
  OutboxRepository,
} from '../../domain/src';
import { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma.service';

type ClaimedRow = {
  id: string;
  aggregatetype: string;
  aggregateid: string;
  eventtype: string;
  payload: Prisma.JsonValue;
  correlationid: string;
  occurredat: Date;
  attemptcount: number;
  maxattempts: number;
  leasetoken: string;
  leaseexpiresat: Date;
};

@Injectable()
export class PrismaOutboxRepository implements OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(event: NewOutboxEvent): Promise<string> {
    return this.enqueueInTransaction(this.prisma, event);
  }

  async enqueueInTransaction(
    transaction: Pick<Prisma.TransactionClient, 'outboxEvent'>,
    event: NewOutboxEvent,
  ): Promise<string> {
    const created = await transaction.outboxEvent.create({
      data: {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
        correlationId: event.correlationId,
        ...(event.maxAttempts === undefined ? {} : { maxAttempts: event.maxAttempts }),
      },
      select: { id: true },
    });
    return created.id;
  }

  async claimBatch(options: OutboxClaimOptions): Promise<readonly ClaimedOutboxEvent[]> {
    this.validateClaim(options);
    const leaseExpiresAt = new Date(options.now.getTime() + options.leaseSeconds * 1000);
    const rows = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(Prisma.sql`
        UPDATE outbox_events
        SET status = 'QUARANTINED',
            lease_token = NULL,
            lease_expires_at = NULL,
            quarantined_at = ${options.now},
            last_error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS',
            updated_at = ${options.now}
        WHERE status = 'LEASED'
          AND lease_expires_at <= ${options.now}
          AND attempt_count >= max_attempts
      `);
      return transaction.$queryRaw<ClaimedRow[]>(Prisma.sql`
        WITH candidates AS (
          SELECT id
          FROM outbox_events
          WHERE (
            (status = 'PENDING' AND next_attempt_at <= ${options.now})
            OR (status = 'LEASED' AND lease_expires_at <= ${options.now})
          )
          AND attempt_count < max_attempts
          ORDER BY next_attempt_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${options.limit}
        )
        UPDATE outbox_events AS event
        SET status = 'LEASED',
            lease_token = ${options.leaseToken}::uuid,
            lease_expires_at = ${leaseExpiresAt},
            attempt_count = event.attempt_count + 1,
            updated_at = ${options.now}
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING
          event.id,
          event.aggregate_type AS aggregateType,
          event.aggregate_id AS aggregateId,
          event.event_type AS eventType,
          event.payload,
          event.correlation_id AS correlationId,
          event.created_at AS occurredAt,
          event.attempt_count AS attemptCount,
          event.max_attempts AS maxAttempts,
          event.lease_token AS leaseToken,
          event.lease_expires_at AS leaseExpiresAt
      `);
    });
    return rows.map((row) => ({
      id: row.id,
      aggregateType: row.aggregatetype,
      aggregateId: row.aggregateid,
      eventType: row.eventtype,
      payload: row.payload as JsonValue,
      correlationId: row.correlationid,
      occurredAt: row.occurredat,
      attemptCount: row.attemptcount,
      maxAttempts: row.maxattempts,
      leaseToken: row.leasetoken,
      leaseExpiresAt: row.leaseexpiresat,
    }));
  }

  async markDelivered(eventId: string, leaseToken: string, deliveredAt: Date): Promise<void> {
    const result = await this.prisma.outboxEvent.updateMany({
      where: { id: eventId, leaseToken, status: 'LEASED' },
      data: {
        status: 'DELIVERED',
        deliveredAt,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
      },
    });
    if (result.count !== 1) throw new Error('OUTBOX_LEASE_LOST');
  }

  async markFailed(
    eventId: string,
    leaseToken: string,
    errorCode: string,
    nextAttemptAt: Date,
    failedAt: Date,
  ): Promise<'RETRY_SCHEDULED' | 'QUARANTINED'> {
    if (!/^[A-Z0-9_:-]{1,100}$/.test(errorCode)) throw new Error('INVALID_OUTBOX_ERROR_CODE');
    return this.prisma.$transaction(async (transaction) => {
      const event = await transaction.outboxEvent.findFirst({
        where: { id: eventId, leaseToken, status: 'LEASED' },
        select: { attemptCount: true, maxAttempts: true },
      });
      if (!event) throw new Error('OUTBOX_LEASE_LOST');
      const quarantined = event.attemptCount >= event.maxAttempts;
      const result = await transaction.outboxEvent.updateMany({
        where: { id: eventId, leaseToken, status: 'LEASED' },
        data: {
          status: quarantined ? 'QUARANTINED' : 'PENDING',
          nextAttemptAt,
          leaseToken: null,
          leaseExpiresAt: null,
          quarantinedAt: quarantined ? failedAt : null,
          lastErrorCode: errorCode,
        },
      });
      if (result.count !== 1) throw new Error('OUTBOX_LEASE_LOST');
      return quarantined ? 'QUARANTINED' : 'RETRY_SCHEDULED';
    });
  }

  private validateClaim(options: OutboxClaimOptions): void {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      throw new Error('INVALID_OUTBOX_BATCH_LIMIT');
    }
    if (
      !Number.isInteger(options.leaseSeconds) ||
      options.leaseSeconds < 1 ||
      options.leaseSeconds > 300
    ) {
      throw new Error('INVALID_OUTBOX_LEASE_SECONDS');
    }
  }
}
