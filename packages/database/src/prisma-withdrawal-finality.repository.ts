import { Injectable } from '@nestjs/common';
import {
  CustodyWebhookClaim,
  WithdrawalFinalityApplication,
  WithdrawalFinalityClaim,
  WithdrawalFinalityEvidence,
  WithdrawalFinalityRepository,
  WithdrawalStatus,
  isWithdrawalFinalityTerminal,
  isWithdrawalTransitionAllowed,
  nextWithdrawalFinalityStatus,
  withdrawalFinalityEvidenceHash,
} from '../../domain/src';
import { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma.service';

type WebhookRow = { id: string; providereventid: string; rawbody: Buffer; leasetoken: string };
type PollRow = {
  id: string;
  withdrawalid: string;
  providertransferid: string;
  leasetoken: string;
  verificationrequired: boolean;
  networkcode: string;
  addressfamily: string;
  destinationaddress: string;
  principalatomic: bigint;
  contractaddress: string | null;
};

@Injectable()
export class PrismaWithdrawalFinalityRepository implements WithdrawalFinalityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimWebhookBatch(input: {
    limit: number;
    leaseSeconds: number;
    leaseToken: string;
    now: Date;
  }): Promise<readonly CustodyWebhookClaim[]> {
    validateClaim(input.limit, input.leaseSeconds);
    const expires = new Date(input.now.getTime() + input.leaseSeconds * 1000);
    const rows = await this.prisma.$queryRaw<WebhookRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT id FROM custody_webhook_inbox
        WHERE status = 'VERIFIED_PENDING' OR (status = 'LEASED' AND lease_expires_at <= ${input.now})
        ORDER BY received_at, created_at FOR UPDATE SKIP LOCKED LIMIT ${input.limit}
      )
      UPDATE custody_webhook_inbox inbox SET status = 'LEASED',
        lease_token = ${input.leaseToken}::uuid, lease_expires_at = ${expires},
        attempt_count = attempt_count + 1, updated_at = ${input.now}
      FROM candidates WHERE inbox.id = candidates.id
      RETURNING inbox.id, inbox.provider_event_id AS providerEventId,
        inbox.raw_body AS rawBody, inbox.lease_token AS leaseToken
    `);
    return rows.map((r) => ({
      inboxId: r.id,
      providerEventId: r.providereventid,
      rawBody: r.rawbody,
      leaseToken: r.leasetoken,
    }));
  }

  async applyWebhookEvidence(
    claim: CustodyWebhookClaim,
    evidence: WithdrawalFinalityEvidence,
    correlationId: string,
    now: Date,
  ): Promise<WithdrawalFinalityApplication | null> {
    if (evidence.source !== 'FIREBLOCKS_WEBHOOK')
      throw new Error('WITHDRAWAL_WEBHOOK_EVIDENCE_SOURCE_INVALID');
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { status: string; leaseToken: string | null; withdrawalId: string | null }[]
      >(Prisma.sql`
        SELECT status, lease_token AS "leaseToken", withdrawal_id AS "withdrawalId"
        FROM custody_webhook_inbox WHERE id = ${claim.inboxId}::uuid FOR UPDATE
      `);
      const inbox = rows[0];
      if (!inbox || inbox.status !== 'LEASED' || inbox.leaseToken !== claim.leaseToken)
        throw new Error('CUSTODY_WEBHOOK_LEASE_LOST');
      const transferId = providerTransferId(claim.rawBody);
      const attempt = transferId
        ? await tx.withdrawalTransactionAttempt.findUnique({
            where: { providerTransferId: transferId },
            select: { withdrawalId: true },
          })
        : null;
      const replacedHash = replacedTransactionHash(claim.rawBody);
      const replacedAttempt =
        !attempt && replacedHash
          ? await tx.withdrawalTransactionHash.findFirst({
              where: { txHash: replacedHash },
              select: { attempt: { select: { withdrawalId: true } } },
            })
          : null;
      const withdrawalId =
        inbox.withdrawalId ?? attempt?.withdrawalId ?? replacedAttempt?.attempt.withdrawalId;
      if (!withdrawalId) {
        await tx.custodyWebhookInbox.update({
          where: { id: claim.inboxId },
          data: {
            status: 'VERIFIED_PENDING',
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: 'FIREBLOCKS_TRANSFER_NOT_LINKED',
          },
        });
        return null;
      }
      const result = await this.applyEvidence(tx, withdrawalId, evidence, correlationId, now);
      await tx.custodyWebhookInbox.update({
        where: { id: claim.inboxId },
        data: {
          withdrawalId,
          status: 'PROCESSED',
          processedAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
        },
      });
      return result;
    });
  }

  async retryWebhook(claim: CustodyWebhookClaim, errorCode: string, now: Date): Promise<void> {
    const result = await this.prisma.custodyWebhookInbox.updateMany({
      where: { id: claim.inboxId, status: 'LEASED', leaseToken: claim.leaseToken },
      data: {
        status: 'VERIFIED_PENDING',
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: safeCode(errorCode),
        updatedAt: now,
      },
    });
    if (result.count !== 1) throw new Error('CUSTODY_WEBHOOK_LEASE_LOST');
  }

  async claimPollingBatch(input: {
    limit: number;
    leaseSeconds: number;
    leaseToken: string;
    now: Date;
  }): Promise<readonly WithdrawalFinalityClaim[]> {
    validateClaim(input.limit, input.leaseSeconds);
    const expires = new Date(input.now.getTime() + input.leaseSeconds * 1000);
    const rows = await this.prisma.$queryRaw<PollRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT job.id FROM withdrawal_finality_jobs job
        WHERE ((job.status = 'PENDING' AND job.due_at <= ${input.now})
          OR (job.status = 'LEASED' AND job.lease_expires_at <= ${input.now}))
        ORDER BY job.due_at, job.created_at FOR UPDATE SKIP LOCKED LIMIT ${input.limit}
      )
      UPDATE withdrawal_finality_jobs job SET status = 'LEASED',
        lease_token = ${input.leaseToken}::uuid, lease_expires_at = ${expires},
        attempt_count = attempt_count + 1, updated_at = ${input.now}
      FROM candidates, withdrawal_transaction_attempts attempt,
        withdrawals withdrawal, treasury_wallets wallet,
        asset_networks asset_network, networks network
      WHERE job.id = candidates.id AND attempt.withdrawal_id = job.withdrawal_id
        AND attempt.is_current AND attempt.provider_transfer_id IS NOT NULL
        AND withdrawal.id = job.withdrawal_id
        AND wallet.id = withdrawal.treasury_wallet_id
        AND asset_network.id = withdrawal.asset_network_id
        AND network.id = asset_network.network_id
      RETURNING job.id, job.withdrawal_id AS withdrawalId,
        attempt.provider_transfer_id AS providerTransferId, job.lease_token AS leaseToken,
        wallet.verification_required AS verificationRequired,
        network.code AS networkCode, network.address_family AS addressFamily,
        withdrawal.destination_address AS destinationAddress,
        withdrawal.principal_atomic AS principalAtomic,
        asset_network.contract_address AS contractAddress
    `);
    return rows.map((r) => ({
      jobId: r.id,
      withdrawalId: r.withdrawalid,
      providerTransferId: r.providertransferid,
      leaseToken: r.leasetoken,
      verificationRequired: r.verificationrequired,
      networkCode: r.networkcode,
      addressFamily: r.addressfamily,
      destinationAddress: r.destinationaddress,
      principalAtomic: r.principalatomic,
      ...(r.contractaddress ? { contractAddress: r.contractaddress } : {}),
    }));
  }

  async applyPollingEvidence(
    claim: WithdrawalFinalityClaim,
    evidence: WithdrawalFinalityEvidence,
    correlationId: string,
    now: Date,
    nextPollAt: Date,
  ): Promise<WithdrawalFinalityApplication> {
    if (evidence.source !== 'FIREBLOCKS_POLL')
      throw new Error('WITHDRAWAL_POLL_EVIDENCE_SOURCE_INVALID');
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.withdrawalFinalityJob.findFirst({
        where: { id: claim.jobId, status: 'LEASED', leaseToken: claim.leaseToken },
        select: { id: true },
      });
      if (!job) throw new Error('WITHDRAWAL_FINALITY_LEASE_LOST');
      const result = await this.applyEvidence(tx, claim.withdrawalId, evidence, correlationId, now);
      await tx.withdrawalFinalityJob.update({
        where: { id: claim.jobId },
        data: isWithdrawalFinalityTerminal(result.status)
          ? { status: 'COMPLETED', leaseToken: null, leaseExpiresAt: null, lastErrorCode: null }
          : {
              status: 'PENDING',
              dueAt: nextPollAt,
              leaseToken: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
            },
      });
      return result;
    });
  }

  async applyChainEvidence(
    withdrawalId: string,
    evidence: WithdrawalFinalityEvidence,
    correlationId: string,
    now: Date,
  ): Promise<WithdrawalFinalityApplication> {
    if (evidence.source !== 'CHAIN_RPC') {
      throw new Error('WITHDRAWAL_CHAIN_EVIDENCE_SOURCE_INVALID');
    }
    return this.prisma.$transaction(async (tx) => {
      const result = await this.applyEvidence(tx, withdrawalId, evidence, correlationId, now);
      if (isWithdrawalFinalityTerminal(result.status)) {
        await tx.withdrawalFinalityJob.updateMany({
          where: { withdrawalId },
          data: {
            status: 'COMPLETED',
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
          },
        });
      }
      return result;
    });
  }
  async retryPolling(
    claim: WithdrawalFinalityClaim,
    errorCode: string,
    nextPollAt: Date,
    now: Date,
  ): Promise<void> {
    const result = await this.prisma.withdrawalFinalityJob.updateMany({
      where: { id: claim.jobId, status: 'LEASED', leaseToken: claim.leaseToken },
      data: {
        status: 'PENDING',
        dueAt: nextPollAt,
        leaseToken: null,
        leaseExpiresAt: null,
        lastErrorCode: safeCode(errorCode),
        updatedAt: now,
      },
    });
    if (result.count !== 1) throw new Error('WITHDRAWAL_FINALITY_LEASE_LOST');
  }

  private async applyEvidence(
    tx: Prisma.TransactionClient,
    withdrawalId: string,
    evidence: WithdrawalFinalityEvidence,
    correlationId: string,
    now: Date,
  ): Promise<WithdrawalFinalityApplication> {
    const locks = await tx.$queryRaw<{ status: WithdrawalStatus }[]>(
      Prisma.sql`SELECT status FROM withdrawals WHERE id = ${withdrawalId}::uuid FOR UPDATE`,
    );
    const current = locks[0]?.status;
    if (!current) throw new Error('WITHDRAWAL_NOT_FOUND');
    const withdrawal = await tx.withdrawal.findUniqueOrThrow({
      where: { id: withdrawalId },
      include: {
        treasuryWallet: true,
        assetNetwork: { include: { network: true } },
        transactionAttempts: { where: { isCurrent: true }, take: 1 },
      },
    });
    let attempt = withdrawal.transactionAttempts[0];
    if (!attempt) throw new Error('WITHDRAWAL_CURRENT_ATTEMPT_MISSING');
    let forcedTarget: WithdrawalStatus | undefined;
    if (evidence.replacedTxHash) {
      const replaced = await tx.withdrawalTransactionHash.findFirst({
        where: { txHash: evidence.replacedTxHash },
        select: { attemptId: true },
      });
      const complete =
        replaced?.attemptId === attempt.id &&
        evidence.txHash &&
        evidence.providerTransferId &&
        evidence.externalTxId;
      if (!complete) {
        forcedTarget = 'RECONCILIATION_REQUIRED';
      } else {
        const existing = await tx.withdrawalTransactionAttempt.findFirst({
          where: {
            OR: [
              { providerTransferId: evidence.providerTransferId },
              { externalTxId: evidence.externalTxId },
            ],
          },
        });
        if (existing) {
          if (existing.withdrawalId !== withdrawalId) {
            forcedTarget = 'RECONCILIATION_REQUIRED';
          } else {
            attempt = existing;
          }
        } else {
          await tx.withdrawalTransactionAttempt.update({
            where: { id: attempt.id },
            data: { status: 'REPLACED', isCurrent: false },
          });
          attempt = await tx.withdrawalTransactionAttempt.create({
            data: {
              withdrawalId,
              attemptNumber: attempt.attemptNumber + 1,
              externalTxId: evidence.externalTxId,
              providerTransferId: evidence.providerTransferId,
              requestHash: withdrawalFinalityEvidenceHash(evidence),
              status: 'SUBMITTED',
              isCurrent: true,
              replacementOfId: attempt.id,
              submittedAt: evidence.observedAt,
            },
          });
          forcedTarget = 'REPLACED';
        }
      }
    }

    let duplicateEvidence = false;
    try {
      await tx.withdrawalFinalityObservation.create({
        data: {
          withdrawalId,
          attemptId: attempt.id,
          source: evidence.source,
          providerEventId: evidence.providerEventId,
          providerStatus: evidence.providerStatus,
          txHash: evidence.txHash,
          blockHash: evidence.blockHash,
          blockNumber: evidence.blockNumber,
          confirmationCount: evidence.confirmationCount,
          executionSucceeded: evidence.executionSucceeded,
          destinationMatches: evidence.destinationMatches,
          amountMatches: evidence.amountMatches,
          assetMatches: evidence.assetMatches,
          networkMatches: evidence.networkMatches,
          normalizedPayloadHash: withdrawalFinalityEvidenceHash(evidence),
          observedAt: evidence.observedAt,
        },
      });
    } catch (error: unknown) {
      if (!isUnique(error)) throw error;
      duplicateEvidence = true;
    }
    if (evidence.txHash)
      await tx.withdrawalTransactionHash.upsert({
        where: { attemptId_txHash: { attemptId: attempt.id, txHash: evidence.txHash } },
        create: { attemptId: attempt.id, txHash: evidence.txHash, observedAt: evidence.observedAt },
        update: {},
      });
    const target =
      forcedTarget ??
      nextWithdrawalFinalityStatus(
        current,
        evidence,
        withdrawal.treasuryWallet.verificationRequired,
        withdrawal.assetNetwork.network.requiredConfirmations,
      );
    if (target === current || isWithdrawalFinalityTerminal(current)) {
      if (!duplicateEvidence && isWithdrawalFinalityTerminal(current) && target !== current) {
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'withdrawal',
            aggregateId: withdrawalId,
            eventType: 'sle.withdrawal.post_finality_conflict',
            correlationId,
            payload: {
              withdrawalId,
              recordedStatus: current,
              observedStatus: target,
              evidenceHash: withdrawalFinalityEvidenceHash(evidence),
            },
          },
        });
      }
      return { withdrawalId, previousStatus: current, status: current, duplicateEvidence };
    }
    if (!isWithdrawalTransitionAllowed(current, target))
      throw new Error('WITHDRAWAL_FINALITY_TRANSITION_INVALID');
    await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: target,
        broadcastedAt: target === 'BROADCASTED' ? now : undefined,
        confirmingAt: target === 'CONFIRMING' ? now : undefined,
        confirmedAt: target === 'CONFIRMED' ? now : undefined,
        failedOnChainAt: target === 'FAILED_ON_CHAIN' ? now : undefined,
        reconciliationRequiredAt: target === 'RECONCILIATION_REQUIRED' ? now : undefined,
      },
    });
    await tx.withdrawalTransactionAttempt.update({
      where: { id: attempt.id },
      data: {
        status: (target === 'REPLACED' ? 'SUBMITTED' : target) as
          | 'SUBMITTED'
          | 'BROADCASTED'
          | 'CONFIRMING'
          | 'CONFIRMED'
          | 'REPLACED'
          | 'FAILED_ON_CHAIN'
          | 'RECONCILIATION_REQUIRED',
      },
    });
    await tx.withdrawalTransition.create({
      data: {
        withdrawalId,
        fromStatus: current,
        toStatus: target,
        reasonCode: 'WITHDRAWAL_FINALITY_' + target,
        correlationId,
        occurredAt: now,
      },
    });
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'withdrawal',
        aggregateId: withdrawalId,
        eventType: 'sle.withdrawal.' + target.toLowerCase(),
        correlationId,
        payload: { withdrawalId, status: target },
      },
    });
    return { withdrawalId, previousStatus: current, status: target, duplicateEvidence };
  }
}

function replacedTransactionHash(rawBody: Uint8Array): string | undefined {
  try {
    const value = JSON.parse(Buffer.from(rawBody).toString('utf8')) as unknown;
    return record(value) && record(value.data) && typeof value.data.replacedTxHash === 'string'
      ? value.data.replacedTxHash
      : undefined;
  } catch {
    return undefined;
  }
}
function providerTransferId(rawBody: Uint8Array): string | undefined {
  try {
    const value = JSON.parse(Buffer.from(rawBody).toString('utf8')) as unknown;
    return record(value) && record(value.data) && typeof value.data.id === 'string'
      ? value.data.id
      : undefined;
  } catch {
    return undefined;
  }
}
function validateClaim(limit: number, leaseSeconds: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('WITHDRAWAL_FINALITY_BATCH_LIMIT_INVALID');
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300)
    throw new Error('WITHDRAWAL_FINALITY_LEASE_SECONDS_INVALID');
}
function safeCode(code: string): string {
  return /^[A-Z0-9_:-]{1,100}$/.test(code) ? code : 'WITHDRAWAL_FINALITY_UNKNOWN_ERROR';
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isUnique(error: unknown): boolean {
  return record(error) && error.code === 'P2002';
}
