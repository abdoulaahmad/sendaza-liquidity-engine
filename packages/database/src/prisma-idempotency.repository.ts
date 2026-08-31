import { Injectable } from '@nestjs/common';
import {
  IdempotencyDecision,
  IdempotencyIdentity,
  IdempotencyRepository,
  JsonValue,
  StoredIdempotencyResponse,
} from '../../domain/src';
import { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaIdempotencyRepository implements IdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async acquire(identity: IdempotencyIdentity): Promise<IdempotencyDecision> {
    try {
      const created = await this.prisma.idempotencyRecord.create({
        data: {
          clientId: identity.clientId,
          operation: identity.operation,
          idempotencyKey: identity.key,
          requestHash: identity.requestHash,
          correlationId: identity.correlationId,
        },
        select: { id: true },
      });
      return { kind: 'ACQUIRED', recordId: created.id };
    } catch (error: unknown) {
      if (!this.isUniqueConstraintError(error)) throw error;
    }

    const existing = await this.prisma.idempotencyRecord.findUniqueOrThrow({
      where: {
        clientId_operation_idempotencyKey: {
          clientId: identity.clientId,
          operation: identity.operation,
          idempotencyKey: identity.key,
        },
      },
    });
    if (existing.requestHash !== identity.requestHash) return { kind: 'CONFLICT' };
    if (existing.status === 'IN_PROGRESS') return { kind: 'IN_PROGRESS' };
    if (existing.responseCode === null || existing.responseBody === null) {
      throw new Error('Completed idempotency record has no stored response');
    }
    return {
      kind: 'REPLAY',
      response: {
        statusCode: existing.responseCode,
        body: existing.responseBody as JsonValue,
      },
    };
  }

  async complete(
    recordId: string,
    requestHash: string,
    response: StoredIdempotencyResponse,
  ): Promise<void> {
    if (
      !Number.isInteger(response.statusCode) ||
      response.statusCode < 100 ||
      response.statusCode > 599
    ) {
      throw new Error('INVALID_IDEMPOTENCY_RESPONSE_CODE');
    }
    const result = await this.prisma.idempotencyRecord.updateMany({
      where: { id: recordId, requestHash, status: 'IN_PROGRESS' },
      data: {
        status: 'COMPLETED',
        responseCode: response.statusCode,
        responseBody: response.body as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    if (result.count !== 1) throw new Error('IDEMPOTENCY_COMPLETION_REJECTED');
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}
