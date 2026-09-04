import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { fromAtomicUnits } from './amount';

export type WithdrawalStatus =
  | 'CREATED'
  | 'POLICY_APPROVED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'SUBMISSION_UNKNOWN'
  | 'FAILED_BEFORE_BROADCAST'
  | 'RECONCILIATION_REQUIRED';

export interface StoredWithdrawal {
  readonly id: string;
  readonly feeQuoteId: string;
  readonly assetNetworkId: string;
  readonly customerReference: string;
  readonly clientLockReference: string;
  readonly clientReference: string;
  readonly destinationAddress: string;
  readonly principalAtomic: bigint;
  readonly totalDebitAtomic: bigint;
  readonly assetDecimals: number;
  readonly externalTxId: string;
  readonly providerTransferId?: string;
  readonly status: WithdrawalStatus;
  readonly createdAt: Date;
  readonly policyApprovedAt?: Date;
  readonly cancelledAt?: Date;
  readonly rejectedAt?: Date;
  readonly submittedAt?: Date;
  readonly failedBeforeBroadcastAt?: Date;
  readonly reconciliationRequiredAt?: Date;
}

export type WithdrawalCreateFailure =
  | 'FEE_QUOTE_NOT_FOUND'
  | 'FEE_QUOTE_EXPIRED'
  | 'FEE_QUOTE_ALREADY_USED'
  | 'DESTINATION_ADDRESS_MISMATCH'
  | 'WITHDRAWAL_POLICY_UNAVAILABLE'
  | 'WITHDRAWAL_REFERENCE_CONFLICT';

export type WithdrawalCancelFailure =
  'WITHDRAWAL_NOT_FOUND' | 'WITHDRAWAL_ALREADY_CLAIMED' | 'WITHDRAWAL_NOT_CANCELLABLE';

export type WithdrawalRepositoryResult<T, C extends string> =
  { readonly kind: 'SUCCESS'; readonly value: T } | { readonly kind: 'FAILURE'; readonly code: C };

export abstract class WithdrawalRepository {
  abstract create(input: {
    readonly feeQuoteId: string;
    readonly customerReference: string;
    readonly clientLockReference: string;
    readonly clientReference: string;
    readonly destinationAddress: string;
    readonly correlationId: string;
    readonly createdAt: Date;
  }): Promise<WithdrawalRepositoryResult<StoredWithdrawal, WithdrawalCreateFailure>>;
  abstract cancel(input: {
    readonly withdrawalId: string;
    readonly correlationId: string;
    readonly cancelledAt: Date;
  }): Promise<WithdrawalRepositoryResult<StoredWithdrawal, WithdrawalCancelFailure>>;
  abstract findById(id: string): Promise<StoredWithdrawal | null>;
}

export interface WithdrawalSubmissionClaim {
  readonly jobId: string;
  readonly withdrawalId: string;
  readonly leaseToken: string;
}

export interface WithdrawalSubmissionContext {
  readonly withdrawalId: string;
  readonly externalTxId: string;
  readonly assetNetworkId: string;
  readonly destinationAddress: string;
  readonly principalAtomic: bigint;
  readonly assetDecimals: number;
}

export abstract class WithdrawalSubmissionJobRepository {
  abstract claimBatch(input: {
    readonly limit: number;
    readonly leaseSeconds: number;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<readonly WithdrawalSubmissionClaim[]>;
  /** Transitions the withdrawal CREATED/POLICY_APPROVED -> SUBMITTING inside the job's lease. */
  abstract beginSubmitting(
    claim: WithdrawalSubmissionClaim,
    correlationId: string,
    now: Date,
  ): Promise<WithdrawalSubmissionContext | null>;
  /** Records the outcome of the external Fireblocks call and completes the job. */
  abstract recordOutcome(
    claim: WithdrawalSubmissionClaim,
    outcome:
      | { readonly kind: 'SUBMITTED'; readonly providerTransferId: string }
      | { readonly kind: 'FAILED_BEFORE_BROADCAST' }
      | { readonly kind: 'SUBMISSION_UNKNOWN' },
    correlationId: string,
    now: Date,
  ): Promise<void>;
  /** Lists SUBMISSION_UNKNOWN withdrawals due for recovery polling, keyed by their externalTxId. */
  abstract listDueRecovery(
    now: Date,
    limit: number,
  ): Promise<readonly { readonly withdrawalId: string; readonly externalTxId: string }[]>;
  /** Resolves a SUBMISSION_UNKNOWN withdrawal after a recovery lookup, without an active job claim. */
  abstract resolveUnknown(
    withdrawalId: string,
    outcome:
      | { readonly kind: 'SUBMITTED'; readonly providerTransferId: string }
      | { readonly kind: 'FAILED_BEFORE_BROADCAST' },
    correlationId: string,
    now: Date,
  ): Promise<void>;
}

export interface CustodyTransferRequest {
  readonly externalTxId: string;
  readonly assetNetworkId: string;
  readonly destinationAddress: string;
  readonly amountAtomic: bigint;
  readonly assetDecimals: number;
}

export type CustodyTransferOutcome =
  | { readonly kind: 'ACCEPTED'; readonly providerTransferId: string }
  | { readonly kind: 'REJECTED'; readonly reasonCode: string }
  | { readonly kind: 'UNKNOWN' };

export abstract class CustodyTransferProvider {
  abstract createTransfer(request: CustodyTransferRequest): Promise<CustodyTransferOutcome>;
  /** Looks up a previously submitted transfer by the SLE-supplied externalTxId, never providerTransferId. */
  abstract findTransferByExternalTxId(externalTxId: string): Promise<CustodyTransferOutcome>;
}

export interface WithdrawalView {
  readonly withdrawalId: string;
  readonly feeQuoteId: string;
  readonly assetNetworkId: string;
  readonly status: WithdrawalStatus;
  readonly principal: string;
  readonly totalDebit: string;
  readonly clientReference: string;
  readonly clientLockReference: string;
  readonly destinationAddress: string;
  readonly createdAt: string;
  readonly cancelledAt?: string;
  readonly rejectedAt?: string;
  readonly submittedAt?: string;
  readonly failedBeforeBroadcastAt?: string;
  readonly reconciliationRequiredAt?: string;
}

export class WithdrawalError extends Error {
  constructor(readonly code: WithdrawalCreateFailure | WithdrawalCancelFailure) {
    super(code);
    this.name = 'WithdrawalError';
  }
}

@Injectable()
export class WithdrawalService {
  constructor(
    private readonly repository: WithdrawalRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(input: {
    feeQuoteId: string;
    customerReference: string;
    clientLockReference: string;
    clientReference: string;
    destinationAddress: string;
    correlationId: string;
  }): Promise<WithdrawalView> {
    const result = await this.repository.create({ ...input, createdAt: this.clock() });
    if (result.kind === 'FAILURE') throw new WithdrawalError(result.code);
    return view(result.value);
  }

  async cancel(input: { withdrawalId: string; correlationId: string }): Promise<WithdrawalView> {
    const result = await this.repository.cancel({ ...input, cancelledAt: this.clock() });
    if (result.kind === 'FAILURE') throw new WithdrawalError(result.code);
    return view(result.value);
  }

  async get(id: string): Promise<WithdrawalView> {
    const withdrawal = await this.repository.findById(id);
    if (!withdrawal) throw new WithdrawalError('WITHDRAWAL_NOT_FOUND');
    return view(withdrawal);
  }
}

/**
 * Executes the Sprint 8 two-transaction submission flow. Fireblocks is called
 * between beginSubmitting (transaction 1, commits POLICY_APPROVED/SUBMITTING +
 * the leased job) and recordOutcome (transaction 2, commits the result) so no
 * PostgreSQL transaction is ever open across the external network call.
 */
@Injectable()
export class WithdrawalSubmissionBatchService {
  constructor(
    private readonly jobs: WithdrawalSubmissionJobRepository,
    private readonly custody: CustodyTransferProvider,
    private readonly batchSize: number,
    private readonly leaseSeconds: number,
  ) {}

  async processBatch(
    now: Date,
    leaseToken: string,
  ): Promise<{ claimed: number; submitted: number; failed: number; unknown: number }> {
    const claims = await this.jobs.claimBatch({
      limit: this.batchSize,
      leaseSeconds: this.leaseSeconds,
      leaseToken,
      now,
    });
    let submitted = 0;
    let failed = 0;
    let unknown = 0;
    for (const claim of claims) {
      const correlationId = randomUUID();
      const begun = await this.jobs.beginSubmitting(claim, correlationId, now);
      if (!begun) continue; // already claimed, cancelled, or in a non-submittable state

      const outcome = await this.custody.createTransfer({
        externalTxId: begun.externalTxId,
        assetNetworkId: begun.assetNetworkId,
        destinationAddress: begun.destinationAddress,
        amountAtomic: begun.principalAtomic,
        assetDecimals: begun.assetDecimals,
      });

      if (outcome.kind === 'ACCEPTED') {
        await this.jobs.recordOutcome(
          claim,
          { kind: 'SUBMITTED', providerTransferId: outcome.providerTransferId },
          correlationId,
          now,
        );
        submitted += 1;
      } else if (outcome.kind === 'REJECTED') {
        await this.jobs.recordOutcome(
          claim,
          { kind: 'FAILED_BEFORE_BROADCAST' },
          correlationId,
          now,
        );
        failed += 1;
      } else {
        await this.jobs.recordOutcome(claim, { kind: 'SUBMISSION_UNKNOWN' }, correlationId, now);
        unknown += 1;
      }
    }
    return { claimed: claims.length, submitted, failed, unknown };
  }
}

/** Recovery worker for SUBMISSION_UNKNOWN withdrawals; looks up by externalTxId, never providerTransferId. */
@Injectable()
export class WithdrawalRecoveryBatchService {
  constructor(
    private readonly jobs: WithdrawalSubmissionJobRepository,
    private readonly custody: CustodyTransferProvider,
    private readonly batchSize: number,
  ) {}

  async processBatch(now: Date): Promise<{
    checked: number;
    resolvedSubmitted: number;
    resolvedFailed: number;
    stillUnknown: number;
  }> {
    const due = await this.jobs.listDueRecovery(now, this.batchSize);
    let resolvedSubmitted = 0;
    let resolvedFailed = 0;
    let stillUnknown = 0;
    for (const item of due) {
      const correlationId = randomUUID();
      const outcome = await this.custody.findTransferByExternalTxId(item.externalTxId);
      if (outcome.kind === 'ACCEPTED') {
        await this.jobs.resolveUnknown(
          item.withdrawalId,
          { kind: 'SUBMITTED', providerTransferId: outcome.providerTransferId },
          correlationId,
          now,
        );
        resolvedSubmitted += 1;
      } else if (outcome.kind === 'REJECTED') {
        await this.jobs.resolveUnknown(
          item.withdrawalId,
          { kind: 'FAILED_BEFORE_BROADCAST' },
          correlationId,
          now,
        );
        resolvedFailed += 1;
      } else {
        stillUnknown += 1;
      }
    }
    return { checked: due.length, resolvedSubmitted, resolvedFailed, stillUnknown };
  }
}

function view(withdrawal: StoredWithdrawal): WithdrawalView {
  return {
    withdrawalId: withdrawal.id,
    feeQuoteId: withdrawal.feeQuoteId,
    assetNetworkId: withdrawal.assetNetworkId,
    status: withdrawal.status,
    principal: fromAtomicUnits(withdrawal.principalAtomic, withdrawal.assetDecimals),
    totalDebit: fromAtomicUnits(withdrawal.totalDebitAtomic, withdrawal.assetDecimals),
    clientReference: withdrawal.clientReference,
    clientLockReference: withdrawal.clientLockReference,
    destinationAddress: withdrawal.destinationAddress,
    createdAt: withdrawal.createdAt.toISOString(),
    ...(withdrawal.cancelledAt ? { cancelledAt: withdrawal.cancelledAt.toISOString() } : {}),
    ...(withdrawal.rejectedAt ? { rejectedAt: withdrawal.rejectedAt.toISOString() } : {}),
    ...(withdrawal.submittedAt ? { submittedAt: withdrawal.submittedAt.toISOString() } : {}),
    ...(withdrawal.failedBeforeBroadcastAt
      ? { failedBeforeBroadcastAt: withdrawal.failedBeforeBroadcastAt.toISOString() }
      : {}),
    ...(withdrawal.reconciliationRequiredAt
      ? { reconciliationRequiredAt: withdrawal.reconciliationRequiredAt.toISOString() }
      : {}),
  };
}
