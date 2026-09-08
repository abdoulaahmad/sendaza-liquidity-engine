import { Injectable } from '@nestjs/common';
import {
  CustodyWebhookInboxRepository,
  CustodyWebhookPersistResult,
  VerifiedCustodyWebhook,
  custodyWebhookPayloadSha256,
} from '../../domain/src';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaCustodyWebhookInboxRepository implements CustodyWebhookInboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  async persistVerified(webhook: VerifiedCustodyWebhook): Promise<CustodyWebhookPersistResult> {
    const attempt = webhook.providerTransferId
      ? await this.prisma.withdrawalTransactionAttempt.findUnique({
          where: { providerTransferId: webhook.providerTransferId },
          select: { withdrawalId: true },
        })
      : null;
    try {
      const created = await this.prisma.custodyWebhookInbox.create({
        data: {
          providerEventId: webhook.providerEventId,
          eventType: webhook.eventType,
          ...(attempt ? { withdrawalId: attempt.withdrawalId } : {}),
          rawBody: Buffer.from(webhook.rawBody),
          payloadSha256: custodyWebhookPayloadSha256(webhook.rawBody),
          signatureKeyId: webhook.signatureKeyId,
          signatureAlgorithm: 'RS512',
          receivedAt: webhook.receivedAt,
        },
        select: { id: true },
      });
      return { kind: 'STORED', inboxId: created.id };
    } catch (error: unknown) {
      if (!isUnique(error)) throw error;
      const existing = await this.prisma.custodyWebhookInbox.findUniqueOrThrow({
        where: { providerEventId: webhook.providerEventId },
        select: { id: true, payloadSha256: true },
      });
      if (existing.payloadSha256 !== custodyWebhookPayloadSha256(webhook.rawBody)) {
        throw new Error('FIREBLOCKS_WEBHOOK_EVENT_ID_CONFLICT', { cause: error });
      }
      return { kind: 'DUPLICATE', inboxId: existing.id };
    }
  }
}

function isUnique(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
