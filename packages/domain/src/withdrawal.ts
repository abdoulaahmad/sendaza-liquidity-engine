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
  | 'CUSTODY_ROUTE_UNAVAILABLE'
  | 'WITHDRAWAL_REQUIRES_MANUAL_REVIEW'
  | 'DESTINATION_ADDRESS_INVALID'
  | 'NETWORK_FEE_EVIDENCE_UNAVAILABLE'
  | 'NETWORK_FEE_TOLERANCE_EXCEEDED'
  | 'TREASURY_EVIDENCE_UNAVAILABLE'
  | 'TREASURY_INSUFFICIENT'
  | 'GAS_RESERVE_INSUFFICIENT'
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
  readonly operation: 'CREATE' | 'LOOKUP';
  readonly withdrawalId: string;
  readonly externalTxId: string;
  readonly providerVaultId: string;
  readonly providerAssetId: string;
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
  /** Starts or resumes submission while holding the job lease. */
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
      | { readonly kind: 'SUBMISSION_UNKNOWN' }
      | { readonly kind: 'RECONCILIATION_REQUIRED' },
    correlationId: string,
    now: Date,
  ): Promise<void>;
}

export interface CustodyTransferRequest {
  readonly externalTxId: string;
  readonly providerVaultId: string;
  readonly providerAssetId: string;
  readonly destinationAddress: string;
  readonly amountAtomic: bigint;
  readonly assetDecimals: number;
}

export type CustodyTransferOutcome =
  | { readonly kind: 'ACCEPTED'; readonly providerTransferId: string }
  | { readonly kind: 'TERMINAL_FAILURE'; readonly reasonCode: string }
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
      if (!begun) continue;

      const outcome =
        begun.operation === 'CREATE'
          ? await this.custody.createTransfer({
              externalTxId: begun.externalTxId,
              providerVaultId: begun.providerVaultId,
              providerAssetId: begun.providerAssetId,
              destinationAddress: begun.destinationAddress,
              amountAtomic: begun.principalAtomic,
              assetDecimals: begun.assetDecimals,
            })
          : await this.custody.findTransferByExternalTxId(begun.externalTxId);

      if (outcome.kind === 'ACCEPTED') {
        await this.jobs.recordOutcome(
          claim,
          { kind: 'SUBMITTED', providerTransferId: outcome.providerTransferId },
          correlationId,
          now,
        );
        submitted += 1;
      } else if (outcome.kind === 'TERMINAL_FAILURE') {
        await this.jobs.recordOutcome(
          claim,
          { kind: 'RECONCILIATION_REQUIRED' },
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

/**
 * A second consumer for faster recovery. It uses the same leased jobs as the
 * submission worker, so multiple processes cannot reconcile the same row.
 */
@Injectable()
export class WithdrawalRecoveryBatchService {
  private readonly batches: WithdrawalSubmissionBatchService;

  constructor(
    jobs: WithdrawalSubmissionJobRepository,
    custody: CustodyTransferProvider,
    batchSize: number,
    leaseSeconds: number,
  ) {
    this.batches = new WithdrawalSubmissionBatchService(jobs, custody, batchSize, leaseSeconds);
  }

  async processBatch(now: Date): Promise<{
    checked: number;
    resolvedSubmitted: number;
    resolvedFailed: number;
    stillUnknown: number;
  }> {
    const result = await this.batches.processBatch(now, randomUUID());
    return {
      checked: result.claimed,
      resolvedSubmitted: result.submitted,
      resolvedFailed: result.failed,
      stillUnknown: result.unknown,
    };
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
