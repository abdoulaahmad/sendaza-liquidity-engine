import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  PurchaseCreateFailure,
  PurchaseRepository,
  PurchaseRepositoryResult,
  PurchaseSettlementFailure,
  StoredPurchase,
  PurchaseTimeoutClaim,
  PurchaseTimeoutRepository,
} from '../../domain/src';
import { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma.service';

type QuoteRow = {
  id: string;
  assetnetworkid: string;
  debit: bigint;
  credit: bigint;
  debitdecimals: number;
  creditdecimals: number;
  expiresat: Date;
  purchaseid: string | null;
};
type InventoryRow = {
  sellable: bigint;
  status: 'MATCHED' | 'UNVERIFIED' | 'MISMATCH' | 'STALE';
  expiresat: Date;
};
type PurchaseWithQuote = Prisma.PurchaseGetPayload<{ include: { quote: true } }>;

@Injectable()
export class PrismaPurchaseRepository implements PurchaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createReservation(
    input: Parameters<PurchaseRepository['createReservation']>[0],
  ): Promise<PurchaseRepositoryResult<StoredPurchase, PurchaseCreateFailure>> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const quotes = await tx.$queryRaw<QuoteRow[]>(Prisma.sql`
          SELECT q.id, q.backing_asset_network_id AS assetNetworkId,
            q.total_debit_atomic AS debit, q.destination_amount_atomic AS credit,
            q.quote_fiat_decimals AS debitDecimals, q.base_asset_decimals AS creditDecimals,
            q.expires_at AS expiresAt, p.id AS purchaseId
          FROM quotes q LEFT JOIN purchases p ON p.quote_id = q.id
          WHERE q.id = ${input.quoteId}::uuid FOR UPDATE OF q
        `);
          const quote = quotes[0];
          if (!quote) return failure('QUOTE_NOT_FOUND');
          if (quote.purchaseid) return failure('QUOTE_ALREADY_USED');
          if (quote.expiresat.getTime() <= input.createdAt.getTime())
            return failure('QUOTE_EXPIRED');

          const inventories = await tx.$queryRaw<InventoryRow[]>(Prisma.sql`
          SELECT sellable_atomic AS sellable, verification_status AS status,
            evidence_expires_at AS expiresAt
          FROM treasury_inventory_state
          WHERE asset_network_id = ${quote.assetnetworkid}::uuid FOR UPDATE
        `);
          const inventory = inventories[0];
          if (!inventory) return failure('INVENTORY_UNAVAILABLE');
          if (inventory.expiresat.getTime() <= input.createdAt.getTime())
            return failure('INVENTORY_EVIDENCE_EXPIRED');
          if (inventory.status !== 'MATCHED') return failure('INVENTORY_EVIDENCE_UNSAFE');
          if (inventory.sellable < quote.credit) return failure('INSUFFICIENT_INVENTORY');

          const purchaseId = randomUUID();
          const reservationExpiresAt = new Date(
            input.createdAt.getTime() + input.reservationTtlSeconds * 1000,
          );
          await tx.purchase.create({
            data: {
              id: purchaseId,
              quoteId: quote.id,
              assetNetworkId: quote.assetnetworkid,
              customerReference: input.customerReference,
              clientLockReference: input.clientLockReference,
              clientReference: input.clientReference,
              correlationId: input.correlationId,
              debitAtomic: quote.debit,
              creditAtomic: quote.credit,
              reservationExpiresAt,
              createdAt: input.createdAt,
            },
          });
          await tx.inventoryReservation.create({
            data: {
              purchaseId,
              assetNetworkId: quote.assetnetworkid,
              amountAtomic: quote.credit,
              expiresAt: reservationExpiresAt,
              createdAt: input.createdAt,
            },
          });
          await tx.treasuryInventoryState.update({
            where: { assetNetworkId: quote.assetnetworkid },
            data: {
              reservedAtomic: { increment: quote.credit },
              sellableAtomic: { decrement: quote.credit },
            },
          });
          await tx.purchaseTransition.create({
            data: {
              purchaseId,
              toStatus: 'RESERVED',
              reasonCode: 'PURCHASE_RESERVED',
              correlationId: input.correlationId,
              occurredAt: input.createdAt,
            },
          });
          await tx.purchaseTimeoutJob.create({ data: { purchaseId, dueAt: reservationExpiresAt } });
          await tx.outboxEvent.create({
            data: {
              aggregateType: 'purchase',
              aggregateId: purchaseId,
              eventType: 'sle.purchase.reserved',
              correlationId: input.correlationId,
              payload: {
                purchaseId,
                quoteId: quote.id,
                clientReference: input.clientReference,
                assetNetworkId: quote.assetnetworkid,
                status: 'RESERVED',
              },
            },
          });
          return success({
            id: purchaseId,
            quoteId: quote.id,
            assetNetworkId: quote.assetnetworkid,
            customerReference: input.customerReference,
            clientLockReference: input.clientLockReference,
            clientReference: input.clientReference,
            debitAtomic: quote.debit,
            debitDecimals: quote.debitdecimals,
            creditAtomic: quote.credit,
            creditDecimals: quote.creditdecimals,
            status: 'RESERVED',
            reservationExpiresAt,
            createdAt: input.createdAt,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 15_000,
          timeout: 15_000,
        },
      );
    } catch (error: unknown) {
      if (isUnique(error)) return failure('PURCHASE_REFERENCE_CONFLICT');
      throw error;
    }
  }

  async settle(
    input: Parameters<PurchaseRepository['settle']>[0],
  ): Promise<PurchaseRepositoryResult<StoredPurchase, PurchaseSettlementFailure>> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw<{ id: string }[]>(
            Prisma.sql`SELECT id FROM purchases WHERE id = ${input.purchaseId}::uuid FOR UPDATE`,
          );
          if (!rows[0]) return failure('PURCHASE_NOT_FOUND');
          const purchase = await tx.purchase.findUniqueOrThrow({
            where: { id: input.purchaseId },
            include: { quote: true, reservation: true, settlement: true },
          });
          if (purchase.settlement) {
            if (
              purchase.settlement.outcome === input.outcome &&
              purchase.settlement.clientSettlementReference === input.clientSettlementReference
            ) {
              return success(mapPurchase(purchase));
            }
            return failure('PURCHASE_SETTLEMENT_CONFLICT');
          }
          if (purchase.status === 'COMPLETED' || purchase.status === 'ROLLED_BACK')
            return failure('PURCHASE_ALREADY_TERMINAL');
          if (!purchase.reservation) throw new Error('PURCHASE_RESERVATION_MISSING');

          await tx.$queryRaw(
            Prisma.sql`SELECT asset_network_id FROM treasury_inventory_state WHERE asset_network_id = ${purchase.assetNetworkId}::uuid FOR UPDATE`,
          );
          const completed = input.outcome === 'COMMITTED';
          await tx.purchase.update({
            where: { id: purchase.id },
            data: completed
              ? { status: 'COMPLETED', completedAt: input.recordedAt }
              : { status: 'ROLLED_BACK', rolledBackAt: input.recordedAt },
          });
          await tx.inventoryReservation.update({
            where: { purchaseId: purchase.id },
            data: { status: completed ? 'ALLOCATED' : 'RELEASED' },
          });
          const inventory = await tx.treasuryInventoryState.findUniqueOrThrow({
            where: { assetNetworkId: purchase.assetNetworkId },
          });
          await tx.treasuryInventoryState.update({
            where: { assetNetworkId: purchase.assetNetworkId },
            data: completed
              ? {
                  reservedAtomic: { decrement: purchase.creditAtomic },
                  allocatedAtomic: { increment: purchase.creditAtomic },
                }
              : {
                  reservedAtomic: { decrement: purchase.creditAtomic },
                  sellableAtomic:
                    inventory.verificationStatus === 'MATCHED' ||
                    inventory.verificationStatus === 'UNVERIFIED'
                      ? { increment: purchase.creditAtomic }
                      : 0n,
                },
          });
          await tx.purchaseSettlement.create({
            data: {
              purchaseId: purchase.id,
              outcome: input.outcome,
              clientSettlementReference: input.clientSettlementReference,
              clientSettledAt: input.clientSettledAt,
              recordedAt: input.recordedAt,
            },
          });
          await tx.purchaseTransition.create({
            data: {
              purchaseId: purchase.id,
              fromStatus: purchase.status,
              toStatus: completed ? 'COMPLETED' : 'ROLLED_BACK',
              reasonCode: completed ? 'SENDAZA_SETTLEMENT_COMMITTED' : 'SENDAZA_LOCK_ROLLED_BACK',
              correlationId: input.correlationId,
              occurredAt: input.recordedAt,
            },
          });
          await tx.purchaseTimeoutJob.update({
            where: { purchaseId: purchase.id },
            data: { status: 'COMPLETED', leaseToken: null, leaseExpiresAt: null },
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: 'purchase',
              aggregateId: purchase.id,
              eventType: completed ? 'sle.purchase.completed' : 'sle.purchase.rolled_back',
              correlationId: input.correlationId,
              payload: {
                purchaseId: purchase.id,
                clientReference: purchase.clientReference,
                status: completed ? 'COMPLETED' : 'ROLLED_BACK',
              },
            },
          });
          const updated = await tx.purchase.findUniqueOrThrow({
            where: { id: purchase.id },
            include: { quote: true },
          });
          return success(mapPurchase(updated));
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 15_000,
          timeout: 15_000,
        },
      );
    } catch (error: unknown) {
      if (isUnique(error)) return failure('PURCHASE_SETTLEMENT_CONFLICT');
      throw error;
    }
  }

  async findById(id: string): Promise<StoredPurchase | null> {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: { quote: true },
    });
    return purchase ? mapPurchase(purchase) : null;
  }
}

type TimeoutRow = { id: string; purchaseid: string; leasetoken: string };

@Injectable()
export class PrismaPurchaseTimeoutRepository implements PurchaseTimeoutRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimBatch(input: {
    limit: number;
    leaseSeconds: number;
    leaseToken: string;
    now: Date;
  }): Promise<readonly PurchaseTimeoutClaim[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
      throw new Error('INVALID_PURCHASE_TIMEOUT_LIMIT');
    const expires = new Date(input.now.getTime() + input.leaseSeconds * 1000);
    const rows = await this.prisma.$queryRaw<TimeoutRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT id FROM purchase_timeout_jobs
        WHERE (status = 'PENDING' AND due_at <= ${input.now})
           OR (status = 'LEASED' AND lease_expires_at <= ${input.now})
        ORDER BY due_at, created_at FOR UPDATE SKIP LOCKED LIMIT ${input.limit}
      ) UPDATE purchase_timeout_jobs AS job
      SET status='LEASED', lease_token=${input.leaseToken}::uuid, lease_expires_at=${expires},
          attempt_count=attempt_count+1, updated_at=${input.now}
      FROM candidates WHERE job.id=candidates.id
      RETURNING job.id, job.purchase_id AS purchaseId, job.lease_token AS leaseToken
    `);
    return rows.map((row) => ({
      jobId: row.id,
      purchaseId: row.purchaseid,
      leaseToken: row.leasetoken,
    }));
  }

  async reconcileOverdue(
    claim: PurchaseTimeoutClaim,
    now: Date,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const jobs = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM purchase_timeout_jobs WHERE id=${claim.jobId}::uuid AND status='LEASED' AND lease_token=${claim.leaseToken}::uuid FOR UPDATE`,
        );
        if (!jobs[0]) throw new Error('PURCHASE_TIMEOUT_LEASE_LOST');
        const purchase = await tx.purchase.findUniqueOrThrow({ where: { id: claim.purchaseId } });
        if (purchase.status === 'RESERVED') {
          await tx.purchase.update({
            where: { id: purchase.id },
            data: { status: 'RECONCILIATION_REQUIRED', reconciliationRequiredAt: now },
          });
          await tx.inventoryReservation.update({
            where: { purchaseId: purchase.id },
            data: { status: 'HELD_RECONCILIATION' },
          });
          await tx.purchaseTransition.create({
            data: {
              purchaseId: purchase.id,
              fromStatus: 'RESERVED',
              toStatus: 'RECONCILIATION_REQUIRED',
              reasonCode: 'SETTLEMENT_ACKNOWLEDGEMENT_TIMEOUT',
              correlationId,
              occurredAt: now,
            },
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: 'purchase',
              aggregateId: purchase.id,
              eventType: 'sle.purchase.reconciliation_required',
              correlationId,
              payload: {
                purchaseId: purchase.id,
                clientReference: purchase.clientReference,
                status: 'RECONCILIATION_REQUIRED',
              },
            },
          });
        }
        await tx.purchaseTimeoutJob.update({
          where: { id: claim.jobId },
          data: { status: 'COMPLETED', leaseToken: null, leaseExpiresAt: null },
        });
      },
      { maxWait: 15_000, timeout: 15_000 },
    );
  }
}

function mapPurchase(p: PurchaseWithQuote): StoredPurchase {
  return {
    id: p.id,
    quoteId: p.quoteId,
    assetNetworkId: p.assetNetworkId,
    customerReference: p.customerReference,
    clientLockReference: p.clientLockReference,
    clientReference: p.clientReference,
    debitAtomic: p.debitAtomic,
    debitDecimals: p.quote.quoteFiatDecimals,
    creditAtomic: p.creditAtomic,
    creditDecimals: p.quote.baseAssetDecimals,
    status: p.status,
    reservationExpiresAt: p.reservationExpiresAt,
    createdAt: p.createdAt,
    ...(p.completedAt ? { completedAt: p.completedAt } : {}),
    ...(p.rolledBackAt ? { rolledBackAt: p.rolledBackAt } : {}),
    ...(p.reconciliationRequiredAt ? { reconciliationRequiredAt: p.reconciliationRequiredAt } : {}),
  };
}
function success<T>(value: T): { kind: 'SUCCESS'; value: T } {
  return { kind: 'SUCCESS', value };
}
function failure<C extends string>(code: C): { kind: 'FAILURE'; code: C } {
  return { kind: 'FAILURE', code };
}
function isUnique(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
