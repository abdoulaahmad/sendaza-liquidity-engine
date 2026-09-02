import { Injectable } from '@nestjs/common';
import { fromAtomicUnits } from './amount';

export type PurchaseState = 'RESERVED' | 'COMPLETED' | 'ROLLED_BACK' | 'RECONCILIATION_REQUIRED';
export type SettlementOutcome = 'COMMITTED' | 'ROLLED_BACK';

export interface StoredPurchase {
  readonly id: string;
  readonly quoteId: string;
  readonly assetNetworkId: string;
  readonly customerReference: string;
  readonly clientLockReference: string;
  readonly clientReference: string;
  readonly debitAtomic: bigint;
  readonly debitDecimals: number;
  readonly creditAtomic: bigint;
  readonly creditDecimals: number;
  readonly status: PurchaseState;
  readonly reservationExpiresAt: Date;
  readonly createdAt: Date;
  readonly completedAt?: Date;
  readonly rolledBackAt?: Date;
  readonly reconciliationRequiredAt?: Date;
}

export type PurchaseCreateFailure =
  | 'QUOTE_NOT_FOUND'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_ALREADY_USED'
  | 'INVENTORY_UNAVAILABLE'
  | 'INVENTORY_EVIDENCE_EXPIRED'
  | 'INVENTORY_EVIDENCE_UNSAFE'
  | 'INSUFFICIENT_INVENTORY'
  | 'PURCHASE_REFERENCE_CONFLICT';
export type PurchaseSettlementFailure =
  'PURCHASE_NOT_FOUND' | 'PURCHASE_SETTLEMENT_CONFLICT' | 'PURCHASE_ALREADY_TERMINAL';
export type PurchaseRepositoryResult<T, C extends string> =
  { readonly kind: 'SUCCESS'; readonly value: T } | { readonly kind: 'FAILURE'; readonly code: C };

export abstract class PurchaseRepository {
  abstract createReservation(input: {
    readonly quoteId: string;
    readonly customerReference: string;
    readonly clientLockReference: string;
    readonly clientReference: string;
    readonly correlationId: string;
    readonly createdAt: Date;
    readonly reservationTtlSeconds: number;
  }): Promise<PurchaseRepositoryResult<StoredPurchase, PurchaseCreateFailure>>;
  abstract settle(input: {
    readonly purchaseId: string;
    readonly outcome: SettlementOutcome;
    readonly clientSettlementReference: string;
    readonly clientSettledAt: Date;
    readonly correlationId: string;
    readonly recordedAt: Date;
  }): Promise<PurchaseRepositoryResult<StoredPurchase, PurchaseSettlementFailure>>;
  abstract findById(id: string): Promise<StoredPurchase | null>;
}

export interface PurchaseTimeoutClaim {
  readonly jobId: string;
  readonly purchaseId: string;
  readonly leaseToken: string;
}
export abstract class PurchaseTimeoutRepository {
  abstract claimBatch(input: {
    limit: number;
    leaseSeconds: number;
    leaseToken: string;
    now: Date;
  }): Promise<readonly PurchaseTimeoutClaim[]>;
  abstract reconcileOverdue(
    claim: PurchaseTimeoutClaim,
    now: Date,
    correlationId: string,
  ): Promise<void>;
}

@Injectable()
export class PurchaseTimeoutBatchService {
  constructor(
    private readonly jobs: PurchaseTimeoutRepository,
    private readonly batchSize: number,
    private readonly leaseSeconds: number,
  ) {}
  async processBatch(
    now: Date,
    leaseToken: string,
  ): Promise<{ claimed: number; reconciled: number }> {
    const claims = await this.jobs.claimBatch({
      limit: this.batchSize,
      leaseSeconds: this.leaseSeconds,
      leaseToken,
      now,
    });
    for (const claim of claims) await this.jobs.reconcileOverdue(claim, now, claim.leaseToken);
    return { claimed: claims.length, reconciled: claims.length };
  }
}

export interface PurchaseView {
  readonly purchaseId: string;
  readonly quoteId: string;
  readonly assetNetworkId: string;
  readonly status: PurchaseState;
  readonly debitAmount: string;
  readonly creditAmount: string;
  readonly clientReference: string;
  readonly clientLockReference: string;
  readonly reservationExpiresAt: string;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly rolledBackAt?: string;
  readonly reconciliationRequiredAt?: string;
}

export class PurchaseError extends Error {
  constructor(readonly code: PurchaseCreateFailure | PurchaseSettlementFailure) {
    super(code);
    this.name = 'PurchaseError';
  }
}

@Injectable()
export class PurchaseService {
  constructor(
    private readonly repository: PurchaseRepository,
    private readonly reservationTtlSeconds = 60,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(input: {
    quoteId: string;
    customerReference: string;
    clientLockReference: string;
    clientReference: string;
    correlationId: string;
  }): Promise<PurchaseView> {
    const result = await this.repository.createReservation({
      ...input,
      createdAt: this.clock(),
      reservationTtlSeconds: this.reservationTtlSeconds,
    });
    if (result.kind === 'FAILURE') throw new PurchaseError(result.code);
    return view(result.value);
  }

  async settle(input: {
    purchaseId: string;
    outcome: SettlementOutcome;
    clientSettlementReference: string;
    clientSettledAt: Date;
    correlationId: string;
  }): Promise<PurchaseView> {
    const result = await this.repository.settle({ ...input, recordedAt: this.clock() });
    if (result.kind === 'FAILURE') throw new PurchaseError(result.code);
    return view(result.value);
  }

  async get(id: string): Promise<PurchaseView> {
    const purchase = await this.repository.findById(id);
    if (!purchase) throw new PurchaseError('PURCHASE_NOT_FOUND');
    return view(purchase);
  }
}

function view(purchase: StoredPurchase): PurchaseView {
  return {
    purchaseId: purchase.id,
    quoteId: purchase.quoteId,
    assetNetworkId: purchase.assetNetworkId,
    status: purchase.status,
    debitAmount: fromAtomicUnits(purchase.debitAtomic, purchase.debitDecimals),
    creditAmount: fromAtomicUnits(purchase.creditAtomic, purchase.creditDecimals),
    clientReference: purchase.clientReference,
    clientLockReference: purchase.clientLockReference,
    reservationExpiresAt: purchase.reservationExpiresAt.toISOString(),
    createdAt: purchase.createdAt.toISOString(),
    ...(purchase.completedAt ? { completedAt: purchase.completedAt.toISOString() } : {}),
    ...(purchase.rolledBackAt ? { rolledBackAt: purchase.rolledBackAt.toISOString() } : {}),
    ...(purchase.reconciliationRequiredAt
      ? { reconciliationRequiredAt: purchase.reconciliationRequiredAt.toISOString() }
      : {}),
  };
}
