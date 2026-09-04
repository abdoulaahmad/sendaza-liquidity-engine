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
  bufferednativefee: bigint;
  expiresat: Date;
  createdat: Date;
  withdrawalid: string | null;
  addressfamily: string;
};
type PolicyRow = {
  id: string;
  autoapprovemaxatomic: bigint;
  maxfeequoteageseconds: number;
  dailycustomerlimitatomic: bigint | null;
  dailycustomercountlimit: number | null;
  allowfirsttimedestination: boolean;
};
type WalletRow = { id: string };

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
              q.buffered_native_fee_atomic AS bufferedNativeFee,
              q.expires_at AS expiresAt, q.created_at AS createdAt, w.id AS withdrawalId,
              network.address_family AS addressFamily
            FROM withdrawal_fee_quotes q
            JOIN asset_networks asset_network ON asset_network.id = q.asset_network_id
            JOIN networks network ON network.id = asset_network.network_id
            LEFT JOIN withdrawals w ON w.fee_quote_id = q.id
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
          if (!validDestinationAddress(quote.addressfamily, input.destinationAddress)) {
            return failure('DESTINATION_ADDRESS_INVALID');
          }

          const policies = await tx.$queryRaw<PolicyRow[]>(Prisma.sql`
            SELECT id, auto_approve_max_atomic AS autoApproveMaxAtomic,
              max_fee_quote_age_seconds AS maxFeeQuoteAgeSeconds,
              daily_customer_limit_atomic AS dailyCustomerLimitAtomic,
              daily_customer_count_limit AS dailyCustomerCountLimit,
              allow_first_time_destination AS allowFirstTimeDestination
            FROM withdrawal_policy_versions
            WHERE asset_network_id = ${quote.assetnetworkid}::uuid
              AND transfer_type = ${quote.transfertype}::"NetworkTransferType"
              AND status = 'ACTIVE' AND effective_from <= ${input.createdAt}
            ORDER BY version DESC LIMIT 1
          `);
          const policy = policies[0];
          if (!policy) return failure('WITHDRAWAL_POLICY_UNAVAILABLE');
          const quoteAgeMs = input.createdAt.getTime() - quote.createdat.getTime();
          if (quoteAgeMs > policy.maxfeequoteageseconds * 1000) {
            return failure('FEE_QUOTE_EXPIRED');
          }
          if (quote.principal > policy.autoapprovemaxatomic) {
            return failure('WITHDRAWAL_REQUIRES_MANUAL_REVIEW');
          }

          const dayStart = new Date(input.createdAt);
          dayStart.setUTCHours(0, 0, 0, 0);
          const customerVelocity = await tx.withdrawal.aggregate({
            where: {
              customerReference: input.customerReference,
              assetNetworkId: quote.assetnetworkid,
              createdAt: { gte: dayStart, lte: input.createdAt },
              status: {
                in: [
                  'CREATED',
                  'POLICY_APPROVED',
                  'SUBMITTING',
                  'SUBMITTED',
                  'SUBMISSION_UNKNOWN',
                  'RECONCILIATION_REQUIRED',
                ],
              },
            },
            _sum: { principalAtomic: true },
            _count: { _all: true },
          });
          if (
            policy.dailycustomerlimitatomic !== null &&
            (customerVelocity._sum.principalAtomic ?? 0n) + quote.principal >
              policy.dailycustomerlimitatomic
          ) {
            return failure('WITHDRAWAL_REQUIRES_MANUAL_REVIEW');
          }
          if (
            policy.dailycustomercountlimit !== null &&
            customerVelocity._count._all + 1 > policy.dailycustomercountlimit
          ) {
            return failure('WITHDRAWAL_REQUIRES_MANUAL_REVIEW');
          }
          if (!policy.allowfirsttimedestination) {
            const knownDestination = await tx.withdrawal.findFirst({
              where: {
                customerReference: input.customerReference,
                assetNetworkId: quote.assetnetworkid,
                destinationAddress: input.destinationAddress,
                status: 'SUBMITTED',
              },
              select: { id: true },
            });
            if (!knownDestination) return failure('WITHDRAWAL_REQUIRES_MANUAL_REVIEW');
          }

          const wallets = await tx.$queryRaw<WalletRow[]>(Prisma.sql`
            SELECT wallet.id
            FROM treasury_wallets wallet
            JOIN custody_providers provider ON provider.id = wallet.custody_provider_id
            WHERE wallet.asset_network_id = ${quote.assetnetworkid}::uuid
              AND wallet.role = 'PRIMARY'
              AND wallet.status = 'ENABLED'
              AND provider.status = 'ENABLED'
              AND provider.type = 'FIREBLOCKS'
            ORDER BY wallet.created_at, wallet.id
            LIMIT 2
            FOR UPDATE OF wallet
          `);
          if (wallets.length !== 1) return failure('CUSTODY_ROUTE_UNAVAILABLE');
          const treasuryWallet = wallets[0];

          const currentFee = await tx.networkFeeSnapshot.findFirst({
            where: {
              status: 'ACCEPTED',
              expiresAt: { gt: input.createdAt },
              policy: {
                assetNetworkId: quote.assetnetworkid,
                transferType: quote.transfertype,
                status: 'ACTIVE',
                effectiveFrom: { lte: input.createdAt },
              },
            },
            orderBy: { calculatedAt: 'desc' },
            include: { policy: true },
          });
          if (!currentFee?.bufferedNativeFeeAtomic) {
            return failure('NETWORK_FEE_EVIDENCE_UNAVAILABLE');
          }
          const basisPoints = 10_000n;
          const allowedBufferedFee =
            quote.bufferednativefee *
            (basisPoints + BigInt(currentFee.policy.executionToleranceBps));
          if (currentFee.bufferedNativeFeeAtomic * basisPoints > allowedBufferedFee) {
            return failure('NETWORK_FEE_TOLERANCE_EXCEEDED');
          }

          const route = await tx.treasuryWallet.findUniqueOrThrow({
            where: { id: treasuryWallet.id },
            include: {
              assetNetwork: { include: { network: true } },
              snapshots: {
                where: { expiresAt: { gt: input.createdAt } },
                orderBy: { observedAt: 'desc' },
                take: 1,
              },
            },
          });
          const routeEvidence = route.snapshots[0];
          if (
            !routeEvidence ||
            (route.verificationRequired && routeEvidence.verificationStatus !== 'MATCHED')
          ) {
            return failure('TREASURY_EVIDENCE_UNAVAILABLE');
          }

          const committedSinceEvidence = await tx.withdrawal.aggregate({
            where: {
              treasuryWalletId: route.id,
              createdAt: { gt: routeEvidence.observedAt, lte: input.createdAt },
              status: {
                in: [
                  'POLICY_APPROVED',
                  'SUBMITTING',
                  'SUBMITTED',
                  'SUBMISSION_UNKNOWN',
                  'RECONCILIATION_REQUIRED',
                ],
              },
            },
            _sum: { principalAtomic: true },
            _count: { _all: true },
          });
          const committedPrincipal = committedSinceEvidence._sum.principalAtomic ?? 0n;
          if (quote.transfertype === 'NATIVE') {
            const committedFees =
              BigInt(committedSinceEvidence._count._all) * currentFee.bufferedNativeFeeAtomic;
            const required =
              committedPrincipal +
              committedFees +
              quote.principal +
              currentFee.bufferedNativeFeeAtomic +
              route.gasReserveAtomic;
            if (routeEvidence.providerAvailableAtomic < required) {
              return failure('TREASURY_INSUFFICIENT');
            }
          } else {
            if (
              routeEvidence.providerAvailableAtomic <
              committedPrincipal + quote.principal + route.safetyBufferAtomic
            ) {
              return failure('TREASURY_INSUFFICIENT');
            }
            const nativeAssetNetwork = await tx.assetNetwork.findUnique({
              where: {
                assetId_networkId: {
                  assetId: route.assetNetwork.network.nativeAssetId,
                  networkId: route.assetNetwork.networkId,
                },
              },
            });
            if (!nativeAssetNetwork) return failure('GAS_RESERVE_INSUFFICIENT');
            const gasWallets = await tx.treasuryWallet.findMany({
              where: {
                assetNetworkId: nativeAssetNetwork.id,
                role: 'GAS',
                status: 'ENABLED',
                custodyProvider: { type: 'FIREBLOCKS', status: 'ENABLED' },
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: 2,
              include: {
                snapshots: {
                  where: { expiresAt: { gt: input.createdAt } },
                  orderBy: { observedAt: 'desc' },
                  take: 1,
                },
              },
            });
            if (gasWallets.length !== 1) return failure('GAS_RESERVE_INSUFFICIENT');
            const gasWallet = gasWallets[0];
            const gasEvidence = gasWallet.snapshots[0];
            if (
              !gasEvidence ||
              (gasWallet.verificationRequired && gasEvidence.verificationStatus !== 'MATCHED')
            ) {
              return failure('TREASURY_EVIDENCE_UNAVAILABLE');
            }
            if (
              gasEvidence.providerAvailableAtomic <
              currentFee.bufferedNativeFeeAtomic + gasWallet.gasReserveAtomic
            ) {
              return failure('GAS_RESERVE_INSUFFICIENT');
            }
          }

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
              treasuryWalletId: treasuryWallet.id,
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
          await this.approvePolicy(tx, withdrawalId, input.correlationId, input.createdAt);

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
            status: 'POLICY_APPROVED',
            createdAt: input.createdAt,
            policyApprovedAt: input.createdAt,
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
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'withdrawal',
        aggregateId: withdrawalId,
        eventType: 'sle.withdrawal.policy_approved',
        correlationId,
        payload: { withdrawalId, status: 'POLICY_APPROVED' },
      },
    });
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
        include: { feeQuote: true, treasuryWallet: true },
      });
      const firstAttempt =
        withdrawal.status === 'CREATED' || withdrawal.status === 'POLICY_APPROVED';
      const recovery =
        withdrawal.status === 'SUBMITTING' || withdrawal.status === 'SUBMISSION_UNKNOWN';
      if (!firstAttempt && !recovery) return null;
      if (firstAttempt) {
        await tx.withdrawal.update({
          where: { id: withdrawal.id },
          data: { status: 'SUBMITTING' },
        });
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
      }
      return {
        operation: firstAttempt ? 'CREATE' : 'LOOKUP',
        withdrawalId: withdrawal.id,
        externalTxId: withdrawal.externalTxId,
        providerVaultId: withdrawal.treasuryWallet.providerVaultId,
        providerAssetId: withdrawal.treasuryWallet.providerAssetId,
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
      | { readonly kind: 'SUBMISSION_UNKNOWN' }
      | { readonly kind: 'RECONCILIATION_REQUIRED' },
    correlationId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.withdrawalSubmissionJob.findFirst({
        where: { id: claim.jobId, status: 'LEASED', leaseToken: claim.leaseToken },
      });
      if (!job) throw new Error('WITHDRAWAL_SUBMISSION_LEASE_LOST');

      const withdrawal = await tx.withdrawal.findUniqueOrThrow({
        where: { id: claim.withdrawalId },
      });
      if (withdrawal.status !== 'SUBMITTING' && withdrawal.status !== 'SUBMISSION_UNKNOWN') {
        throw new Error('WITHDRAWAL_SUBMISSION_STATE_CHANGED');
      }

      if (outcome.kind === 'SUBMISSION_UNKNOWN' && withdrawal.status === 'SUBMISSION_UNKNOWN') {
        await tx.withdrawalSubmissionJob.update({
          where: { id: claim.jobId },
          data: {
            status: 'PENDING',
            leaseToken: null,
            leaseExpiresAt: null,
            dueAt: new Date(now.getTime() + 10_000),
            lastErrorCode: 'PROVIDER_RESULT_UNKNOWN',
          },
        });
        return;
      }

      const toStatus = outcome.kind;
      await tx.withdrawal.update({
        where: { id: claim.withdrawalId },
        data: {
          status: toStatus,
          ...(outcome.kind === 'SUBMITTED'
            ? { submittedAt: now, providerTransferId: outcome.providerTransferId }
            : {}),
          ...(outcome.kind === 'FAILED_BEFORE_BROADCAST' ? { failedBeforeBroadcastAt: now } : {}),
          ...(outcome.kind === 'RECONCILIATION_REQUIRED' ? { reconciliationRequiredAt: now } : {}),
        },
      });
      await tx.withdrawalTransition.create({
        data: {
          withdrawalId: claim.withdrawalId,
          fromStatus: withdrawal.status,
          toStatus,
          reasonCode: 'WITHDRAWAL_' + toStatus,
          correlationId,
          occurredAt: now,
        },
      });
      const eventType =
        outcome.kind === 'SUBMITTED'
          ? 'sle.withdrawal.submitted'
          : outcome.kind === 'FAILED_BEFORE_BROADCAST'
            ? 'sle.withdrawal.failed_before_broadcast'
            : outcome.kind === 'SUBMISSION_UNKNOWN'
              ? 'sle.withdrawal.submission_unknown'
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
      await tx.withdrawalSubmissionJob.update({
        where: { id: claim.jobId },
        data:
          outcome.kind === 'SUBMISSION_UNKNOWN'
            ? {
                status: 'PENDING',
                leaseToken: null,
                leaseExpiresAt: null,
                dueAt: new Date(now.getTime() + 10_000),
                lastErrorCode: 'PROVIDER_RESULT_UNKNOWN',
              }
            : {
                status: 'COMPLETED',
                leaseToken: null,
                leaseExpiresAt: null,
                lastErrorCode: null,
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
function validDestinationAddress(addressFamily: string, address: string): boolean {
  if (addressFamily === 'EVM') return /^0x[0-9a-fA-F]{40}$/.test(address);
  // TEST exists only in isolated integration fixtures and is never a deployable route.
  if (addressFamily === 'TEST') return /^0x[0-9A-Z]{8,64}$/.test(address);
  return false;
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
