import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  StoredWithdrawal,
  WithdrawalCancelFailure,
  WithdrawalCreateFailure,
  WithdrawalRepository,
  WithdrawalRepositoryResult,
  WithdrawalSubmissionClaim,
  WithdrawalSubmissionContext,
  WithdrawalSubmissionJobRepository,
} from '../../domain/src';
import { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma.service';

type FeeQuoteRow = {
  id: string;
  assetnetworkid: string;
  transfertype: 'NATIVE' | 'TOKEN';
  destinationaddress: string;
  principal: bigint;
  totaldebit: bigint;
  assetdecimals: number;
  expiresat: Date;
  withdrawalid: string | null;
};
type PolicyRow = { id: string; autoapprovemaxatomic: bigint };

@Injectable()
export class PrismaWithdrawalRepository implements WithdrawalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: Parameters<WithdrawalRepository['create']>[0],
  ): Promise<WithdrawalRepositoryResult<StoredWithdrawal, WithdrawalCreateFailure>> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const quotes = await tx.$queryRaw<FeeQuoteRow[]>(Prisma.sql`
            SELECT q.id, q.asset_network_id AS assetNetworkId, q.transfer_type AS transferType,
              q.destination_address AS destinationAddress, q.principal_atomic AS principal,
              q.total_debit_atomic AS totalDebit, q.asset_decimals AS assetDecimals,
              q.expires_at AS expiresAt, w.id AS withdrawalId
            FROM withdrawal_fee_quotes q LEFT JOIN withdrawals w ON w.fee_quote_id = q.id
            WHERE q.id = ${input.feeQuoteId}::uuid FOR UPDATE OF q
          `);
          const quote = quotes[0];
          if (!quote) return failure('FEE_QUOTE_NOT_FOUND');
          if (quote.withdrawalid) return failure('FEE_QUOTE_ALREADY_USED');
          if (quote.expiresat.getTime() <= input.createdAt.getTime()) {
            return failure('FEE_QUOTE_EXPIRED');
          }
          if (quote.destinationaddress !== input.destinationAddress) {
            return failure('DESTINATION_ADDRESS_MISMATCH');
          }

          const policies = await tx.$queryRaw<PolicyRow[]>(Prisma.sql`
            SELECT id, auto_approve_max_atomic AS autoApproveMaxAtomic
            FROM withdrawal_policy_versions
            WHERE asset_network_id = ${quote.assetnetworkid}::uuid
              AND transfer_type = ${quote.transfertype}::"NetworkTransferType"
              AND status = 'ACTIVE' AND effective_from <= ${input.createdAt}
            ORDER BY version DESC LIMIT 1
          `);
          const policy = policies[0];
          if (!policy) return failure('WITHDRAWAL_POLICY_UNAVAILABLE');

          const withdrawalId = randomUUID();
          // The withdrawal's own ID is supplied to Fireblocks as externalTxId so
          // resubmission is idempotent and recovery never depends on a
          // provider-generated identifier that may be unknown after a timeout.
          const externalTxId = withdrawalId;
          await tx.withdrawal.create({
            data: {
              id: withdrawalId,
              feeQuoteId: quote.id,
              assetNetworkId: quote.assetnetworkid,
              policyId: policy.id,
              customerReference: input.customerReference,
              clientLockReference: input.clientLockReference,
              clientReference: input.clientReference,
              destinationAddress: input.destinationAddress,
              correlationId: input.correlationId,
              principalAtomic: quote.principal,
              totalDebitAtomic: quote.totaldebit,
              externalTxId,
              createdAt: input.createdAt,
            },
          });
          await tx.withdrawalTransition.create({
            data: {
              withdrawalId,
              toStatus: 'CREATED',
              reasonCode: 'WITHDRAWAL_CREATED',
              correlationId: input.correlationId,
              occurredAt: input.createdAt,
            },
          });
          await tx.outboxEvent.create({
            data: {
              aggregateType: 'withdrawal',
              aggregateId: withdrawalId,
              eventType: 'sle.withdrawal.policy_approved',
              correlationId: input.correlationId,
              payload: {
                withdrawalId,
                feeQuoteId: quote.id,
                clientReference: input.clientReference,
                assetNetworkId: quote.assetnetworkid,
                status: 'CREATED',
              },
            },
          });

          const policyApproved =
            quote.totaldebit <= policy.autoapprovemaxatomic
              ? await this.approvePolicy(tx, withdrawalId, input.correlationId, input.createdAt)
              : null;

          return success({
            id: withdrawalId,
            feeQuoteId: quote.id,
            assetNetworkId: quote.assetnetworkid,
            customerReference: input.customerReference,
            clientLockReference: input.clientLockReference,
            clientReference: input.clientReference,
            destinationAddress: input.destinationAddress,
            principalAtomic: quote.principal,
            totalDebitAtomic: quote.totaldebit,
            assetDecimals: quote.assetdecimals,
            externalTxId,
            status: policyApproved ? 'POLICY_APPROVED' : 'CREATED',
            createdAt: input.createdAt,
            ...(policyApproved ? { policyApprovedAt: input.createdAt } : {}),
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 15_000,
          timeout: 15_000,
        },
      );
    } catch (error: unknown) {
      if (isUnique(error)) return failure('WITHDRAWAL_REFERENCE_CONFLICT');
      throw error;
    }
  }

  private async approvePolicy(
    tx: Prisma.TransactionClient,
    withdrawalId: string,
    correlationId: string,
    now: Date,
  ): Promise<true> {
    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: 'POLICY_APPROVED', policyApprovedAt: now },
    });
    await tx.withdrawalTransition.create({
      data: {
        withdrawalId,
        fromStatus: 'CREATED',
        toStatus: 'POLICY_APPROVED',
        reasonCode: 'WITHDRAWAL_POLICY_AUTO_APPROVED',
        correlationId,
        occurredAt: now,
      },
    });
    await tx.withdrawalSubmissionJob.create({ data: { withdrawalId, dueAt: now } });
    return true;
  }

  async cancel(
    input: Parameters<WithdrawalRepository['cancel']>[0],
  ): Promise<WithdrawalRepositoryResult<StoredWithdrawal, WithdrawalCancelFailure>> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM withdrawals WHERE id = ${input.withdrawalId}::uuid FOR UPDATE`,
        );
        if (!rows[0]) return failure('WITHDRAWAL_NOT_FOUND');
        const withdrawal = await tx.withdrawal.findUniqueOrThrow({
          where: { id: input.withdrawalId },
          include: { feeQuote: true, submissionJob: true },
        });
        if (withdrawal.status !== 'CREATED' && withdrawal.status !== 'POLICY_APPROVED') {
          return failure('WITHDRAWAL_NOT_CANCELLABLE');
        }
        if (withdrawal.submissionJob) {
          // A claimed or leased job means a worker may already be submitting;
          // cancellation is unsafe past this point regardless of Withdrawal.status.
          const jobRows = await tx.$queryRaw<{ status: string; leaseToken: string | null }[]>(
            Prisma.sql`SELECT status, lease_token AS "leaseToken" FROM withdrawal_submission_jobs WHERE withdrawal_id = ${input.withdrawalId}::uuid FOR UPDATE`,
          );
          if (jobRows[0] && (jobRows[0].status === 'LEASED' || jobRows[0].leaseToken !== null)) {
            return failure('WITHDRAWAL_ALREADY_CLAIMED');
          }
          await tx.withdrawalSubmissionJob.delete({ where: { withdrawalId: input.withdrawalId } });
        }
        await tx.withdrawal.update({
          where: { id: input.withdrawalId },
          data: { status: 'CANCELLED', cancelledAt: input.cancelledAt },
        });
        await tx.withdrawalTransition.create({
          data: {
            withdrawalId: input.withdrawalId,
            fromStatus: withdrawal.status,
            toStatus: 'CANCELLED',
            reasonCode: 'WITHDRAWAL_CANCELLED_BY_CLIENT',
            correlationId: input.correlationId,
            occurredAt: input.cancelledAt,
          },
        });
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'withdrawal',
            aggregateId: input.withdrawalId,
            eventType: 'sle.withdrawal.cancelled',
            correlationId: input.correlationId,
            payload: {
              withdrawalId: input.withdrawalId,
              clientReference: withdrawal.clientReference,
              status: 'CANCELLED',
            },
          },
        });
        return success(
          mapWithdrawal({ ...withdrawal, status: 'CANCELLED', cancelledAt: input.cancelledAt }),
        );
      },
      { maxWait: 15_000, timeout: 15_000 },
    );
  }

  async findById(id: string): Promise<StoredWithdrawal | null> {
    const withdrawal = await this.prisma.withdrawal.findUnique({
      where: { id },
      include: { feeQuote: true },
    });
    return withdrawal ? mapWithdrawal(withdrawal) : null;
  }
}

@Injectable()
export class PrismaWithdrawalSubmissionJobRepository implements WithdrawalSubmissionJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimBatch(input: {
    readonly limit: number;
    readonly leaseSeconds: number;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<readonly WithdrawalSubmissionClaim[]> {
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1000);
    const rows = await this.prisma.$queryRaw<
      { id: string; withdrawalid: string; leasetoken: string }[]
    >(Prisma.sql`
      WITH candidates AS (
        SELECT id FROM withdrawal_submission_jobs
        WHERE (status = 'PENDING' AND due_at <= ${input.now})
           OR (status = 'LEASED' AND lease_expires_at <= ${input.now})
        ORDER BY due_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${input.limit}
      )
      UPDATE withdrawal_submission_jobs AS job
      SET status = 'LEASED', lease_token = ${input.leaseToken}::uuid,
          lease_expires_at = ${leaseExpiresAt}, attempt_count = attempt_count + 1,
          updated_at = ${input.now}
      FROM candidates WHERE job.id = candidates.id
      RETURNING job.id, job.withdrawal_id AS withdrawalId, job.lease_token AS leaseToken
    `);
    return rows.map((row) => ({
      jobId: row.id,
      withdrawalId: row.withdrawalid,
      leaseToken: row.leasetoken,
    }));
  }

  async beginSubmitting(
    claim: WithdrawalSubmissionClaim,
    correlationId: string,
    now: Date,
  ): Promise<WithdrawalSubmissionContext | null> {
    return this.prisma.$transaction(async (tx) => {
      const jobRows = await tx.$queryRaw<{ status: string; leaseToken: string | null }[]>(
        Prisma.sql`SELECT status, lease_token AS "leaseToken" FROM withdrawal_submission_jobs WHERE id = ${claim.jobId}::uuid FOR UPDATE`,
      );
      if (
        !jobRows[0] ||
        jobRows[0].status !== 'LEASED' ||
        jobRows[0].leaseToken !== claim.leaseToken
      ) {
        return null;
      }
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({
        where: { id: claim.withdrawalId },
        include: { feeQuote: true },
      });
      if (withdrawal.status !== 'CREATED' && withdrawal.status !== 'POLICY_APPROVED') return null;
      await tx.withdrawal.update({ where: { id: withdrawal.id }, data: { status: 'SUBMITTING' } });
      await tx.withdrawalTransition.create({
        data: {
          withdrawalId: withdrawal.id,
          fromStatus: withdrawal.status,
          toStatus: 'SUBMITTING',
          reasonCode: 'WITHDRAWAL_SUBMISSION_STARTED',
          correlationId,
          occurredAt: now,
        },
      });
      return {
        withdrawalId: withdrawal.id,
        externalTxId: withdrawal.externalTxId,
        assetNetworkId: withdrawal.assetNetworkId,
        destinationAddress: withdrawal.destinationAddress,
        principalAtomic: withdrawal.principalAtomic,
        assetDecimals: withdrawal.feeQuote.assetDecimals,
      };
    });
  }

  async recordOutcome(
    claim: WithdrawalSubmissionClaim,
    outcome:
      | { readonly kind: 'SUBMITTED'; readonly providerTransferId: string }
      | { readonly kind: 'FAILED_BEFORE_BROADCAST' }
      | { readonly kind: 'SUBMISSION_UNKNOWN' },
    correlationId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findUniqueOrThrow({
        where: { id: claim.withdrawalId },
      });
      const toStatus = outcome.kind;
      await tx.withdrawal.update({
        where: { id: claim.withdrawalId },
        data: {
          status: toStatus,
          ...(outcome.kind === 'SUBMITTED'
            ? { submittedAt: now, providerTransferId: outcome.providerTransferId }
            : {}),
          ...(outcome.kind === 'FAILED_BEFORE_BROADCAST' ? { failedBeforeBroadcastAt: now } : {}),
        },
      });
      await tx.withdrawalTransition.create({
        data: {
          withdrawalId: claim.withdrawalId,
          fromStatus: withdrawal.status,
          toStatus,
          reasonCode: `WITHDRAWAL_${toStatus}`,
          correlationId,
          occurredAt: now,
        },
      });
      const eventType =
        outcome.kind === 'SUBMITTED'
          ? 'sle.withdrawal.submitted'
          : outcome.kind === 'FAILED_BEFORE_BROADCAST'
            ? 'sle.withdrawal.failed_before_broadcast'
            : 'sle.withdrawal.reconciliation_required';
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'withdrawal',
          aggregateId: claim.withdrawalId,
          eventType,
          correlationId,
          payload: { withdrawalId: claim.withdrawalId, status: toStatus },
        },
      });
      const result = await tx.withdrawalSubmissionJob.updateMany({
        where: { id: claim.jobId, status: 'LEASED', leaseToken: claim.leaseToken },
        data:
          outcome.kind === 'SUBMISSION_UNKNOWN'
            ? {
                status: 'PENDING',
                leaseToken: null,
                leaseExpiresAt: null,
                dueAt: new Date(now.getTime() + 10_000),
              }
            : { status: 'COMPLETED', leaseToken: null, leaseExpiresAt: null },
      });
      if (result.count !== 1) throw new Error('WITHDRAWAL_SUBMISSION_LEASE_LOST');
    });
  }

  async listDueRecovery(
    now: Date,
    limit: number,
  ): Promise<readonly { readonly withdrawalId: string; readonly externalTxId: string }[]> {
    const withdrawals = await this.prisma.withdrawal.findMany({
      where: { status: 'SUBMISSION_UNKNOWN' },
      orderBy: { updatedAt: 'asc' },
      take: limit,
      select: { id: true, externalTxId: true },
    });
    return withdrawals.map((w) => ({ withdrawalId: w.id, externalTxId: w.externalTxId }));
  }

  async resolveUnknown(
    withdrawalId: string,
    outcome:
      | { readonly kind: 'SUBMITTED'; readonly providerTransferId: string }
      | { readonly kind: 'FAILED_BEFORE_BROADCAST' },
    correlationId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.withdrawal.updateMany({
        where: { id: withdrawalId, status: 'SUBMISSION_UNKNOWN' },
        data: {
          status: outcome.kind,
          ...(outcome.kind === 'SUBMITTED'
            ? { submittedAt: now, providerTransferId: outcome.providerTransferId }
            : { failedBeforeBroadcastAt: now }),
        },
      });
      if (result.count !== 1) return;
      await tx.withdrawalTransition.create({
        data: {
          withdrawalId,
          fromStatus: 'SUBMISSION_UNKNOWN',
          toStatus: outcome.kind,
          reasonCode: `WITHDRAWAL_RECOVERY_${outcome.kind}`,
          correlationId,
          occurredAt: now,
        },
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'withdrawal',
          aggregateId: withdrawalId,
          eventType:
            outcome.kind === 'SUBMITTED'
              ? 'sle.withdrawal.submitted'
              : 'sle.withdrawal.failed_before_broadcast',
          correlationId,
          payload: { withdrawalId, status: outcome.kind },
        },
      });
    });
  }
}

function mapWithdrawal(
  w: Prisma.WithdrawalGetPayload<{ include: { feeQuote: true } }>,
): StoredWithdrawal {
  return {
    id: w.id,
    feeQuoteId: w.feeQuoteId,
    assetNetworkId: w.assetNetworkId,
    customerReference: w.customerReference,
    clientLockReference: w.clientLockReference,
    clientReference: w.clientReference,
    destinationAddress: w.destinationAddress,
    principalAtomic: w.principalAtomic,
    totalDebitAtomic: w.totalDebitAtomic,
    assetDecimals: w.feeQuote.assetDecimals,
    externalTxId: w.externalTxId,
    ...(w.providerTransferId ? { providerTransferId: w.providerTransferId } : {}),
    status: w.status,
    createdAt: w.createdAt,
    ...(w.policyApprovedAt ? { policyApprovedAt: w.policyApprovedAt } : {}),
    ...(w.cancelledAt ? { cancelledAt: w.cancelledAt } : {}),
    ...(w.rejectedAt ? { rejectedAt: w.rejectedAt } : {}),
    ...(w.submittedAt ? { submittedAt: w.submittedAt } : {}),
    ...(w.failedBeforeBroadcastAt ? { failedBeforeBroadcastAt: w.failedBeforeBroadcastAt } : {}),
    ...(w.reconciliationRequiredAt ? { reconciliationRequiredAt: w.reconciliationRequiredAt } : {}),
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
