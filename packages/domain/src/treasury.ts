import { Injectable } from '@nestjs/common';
import { AmountPrecisionError, toAtomicUnits } from './amount';

export type CustodyProviderKind = 'FIREBLOCKS' | 'DETERMINISTIC_FAKE';
export type TreasuryVerificationStatus = 'MATCHED' | 'UNVERIFIED' | 'MISMATCH' | 'STALE';

export interface TreasurySyncTarget {
  readonly walletId: string;
  readonly assetNetworkId: string;
  readonly networkCode: string;
  readonly addressFamily: string;
  readonly assetDecimals: number;
  readonly contractAddress?: string;
  readonly providerKind: CustodyProviderKind;
  readonly providerCode: string;
  readonly providerVaultId: string;
  readonly providerAssetId: string;
  readonly publicAddress: string;
  readonly addressTag?: string;
  readonly verificationRequired: boolean;
  readonly safetyBufferAtomic: bigint;
  readonly gasReserveAtomic: bigint;
  readonly staleAfterSeconds: number;
}

export interface CustodyBalanceEvidence {
  readonly total: string;
  readonly available: string;
  readonly pending: string;
  readonly frozen: string;
  readonly locked: string;
  readonly addresses: readonly { readonly address: string; readonly tag?: string }[];
  readonly observedAt: Date;
  readonly providerReference?: string;
}

export abstract class CustodyProvider {
  abstract getWalletBalance(target: TreasurySyncTarget): Promise<CustodyBalanceEvidence>;
}

export abstract class CustodyProviderResolver {
  abstract resolve(kind: CustodyProviderKind, code: string): CustodyProvider;
}

export abstract class ChainBalanceProvider {
  abstract getConfirmedBalanceAtomic(target: TreasurySyncTarget): Promise<bigint>;
}

export abstract class ChainBalanceProviderResolver {
  abstract resolve(networkCode: string, addressFamily: string): ChainBalanceProvider;
}

export interface NewTreasurySnapshot {
  readonly walletId: string;
  readonly assetNetworkId: string;
  readonly controlledAtomic: bigint;
  readonly providerAvailableAtomic: bigint;
  readonly pendingAtomic: bigint;
  readonly frozenAtomic: bigint;
  readonly lockedAtomic: bigint;
  readonly chainConfirmedAtomic?: bigint;
  readonly reservedAtomic: bigint;
  readonly safetyBufferAtomic: bigint;
  readonly gasReserveAtomic: bigint;
  readonly unavailableAtomic: bigint;
  readonly sellableAtomic: bigint;
  readonly verificationStatus: TreasuryVerificationStatus;
  readonly providerReference?: string;
  readonly observedAt: Date;
  readonly expiresAt: Date;
}

export abstract class TreasuryRepository {
  abstract listSyncTargets(): Promise<readonly TreasurySyncTarget[]>;
  abstract saveSnapshot(snapshot: NewTreasurySnapshot): Promise<string>;
}

export interface TreasurySyncClaim {
  readonly jobId: string;
  readonly walletId: string;
  readonly leaseToken: string;
}

export abstract class TreasurySyncJobRepository {
  abstract claimBatch(input: {
    readonly limit: number;
    readonly leaseSeconds: number;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<readonly TreasurySyncClaim[]>;
  abstract complete(jobId: string, leaseToken: string, nextSyncAt: Date): Promise<void>;
  abstract fail(
    jobId: string,
    leaseToken: string,
    nextSyncAt: Date,
    errorCode: string,
  ): Promise<void>;
}

export interface TreasurySyncResult {
  readonly walletId: string;
  readonly snapshotId: string;
  readonly verificationStatus: TreasuryVerificationStatus;
  readonly sellableAtomic: bigint;
}

export class TreasuryEvidenceError extends Error {
  constructor(readonly code: 'INVALID_PROVIDER_EVIDENCE' | 'PROVIDER_ADDRESS_MISMATCH') {
    super(code);
    this.name = 'TreasuryEvidenceError';
  }
}

@Injectable()
export class TreasurySynchronizationService {
  constructor(
    private readonly repository: TreasuryRepository,
    private readonly custodyProviders: CustodyProviderResolver,
    private readonly chainProviders: ChainBalanceProviderResolver,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async synchronize(target: TreasurySyncTarget): Promise<TreasurySyncResult> {
    const now = this.clock();
    const provider = this.custodyProviders.resolve(target.providerKind, target.providerCode);
    const evidence = await provider.getWalletBalance(target);
    const amounts = parseEvidence(evidence, target.assetDecimals);
    if (amounts.available > amounts.total)
      throw new TreasuryEvidenceError('INVALID_PROVIDER_EVIDENCE');
    if (!addressMatches(target, evidence.addresses)) {
      throw new TreasuryEvidenceError('PROVIDER_ADDRESS_MISMATCH');
    }

    const expiresAt = new Date(evidence.observedAt.getTime() + target.staleAfterSeconds * 1000);
    let status: TreasuryVerificationStatus =
      expiresAt.getTime() <= now.getTime() ? 'STALE' : 'UNVERIFIED';
    let chainConfirmedAtomic: bigint | undefined;
    if (target.verificationRequired && status !== 'STALE') {
      chainConfirmedAtomic = await this.chainProviders
        .resolve(target.networkCode, target.addressFamily)
        .getConfirmedBalanceAtomic(target);
      status = chainConfirmedAtomic === amounts.total ? 'MATCHED' : 'MISMATCH';
    }

    const operationalUnavailable = amounts.total - amounts.available;
    const reserve = target.safetyBufferAtomic + target.gasReserveAtomic;
    const sellable =
      status === 'MATCHED' || (!target.verificationRequired && status === 'UNVERIFIED')
        ? nonNegative(amounts.available - reserve)
        : 0n;
    const snapshot: NewTreasurySnapshot = {
      walletId: target.walletId,
      assetNetworkId: target.assetNetworkId,
      controlledAtomic: amounts.total,
      providerAvailableAtomic: amounts.available,
      pendingAtomic: amounts.pending,
      frozenAtomic: amounts.frozen,
      lockedAtomic: amounts.locked,
      chainConfirmedAtomic,
      reservedAtomic: 0n,
      safetyBufferAtomic: target.safetyBufferAtomic,
      gasReserveAtomic: target.gasReserveAtomic,
      unavailableAtomic: operationalUnavailable,
      sellableAtomic: sellable,
      verificationStatus: status,
      providerReference: evidence.providerReference,
      observedAt: evidence.observedAt,
      expiresAt,
    };
    const snapshotId = await this.repository.saveSnapshot(snapshot);
    return {
      walletId: target.walletId,
      snapshotId,
      verificationStatus: status,
      sellableAtomic: sellable,
    };
  }

  async synchronizeAll(): Promise<readonly TreasurySyncResult[]> {
    const targets = await this.repository.listSyncTargets();
    return Promise.all(targets.map((target) => this.synchronize(target)));
  }
}

export interface TreasurySyncBatchResult {
  readonly claimed: number;
  readonly synchronized: number;
  readonly failed: number;
}

@Injectable()
export class TreasurySyncBatchService {
  constructor(
    private readonly jobs: TreasurySyncJobRepository,
    private readonly treasury: TreasuryRepository,
    private readonly synchronization: TreasurySynchronizationService,
    private readonly batchSize: number,
    private readonly leaseSeconds: number,
    private readonly refreshSeconds: number,
    private readonly retrySeconds: number,
  ) {}

  async processBatch(now: Date, leaseToken: string): Promise<TreasurySyncBatchResult> {
    const claims = await this.jobs.claimBatch({
      limit: this.batchSize,
      leaseSeconds: this.leaseSeconds,
      leaseToken,
      now,
    });
    const targets = await this.treasury.listSyncTargets();
    const byWallet = new Map(targets.map((target) => [target.walletId, target]));
    let synchronized = 0;
    let failed = 0;
    for (const claim of claims) {
      try {
        const target = byWallet.get(claim.walletId);
        if (!target) throw new Error('TREASURY_WALLET_UNAVAILABLE');
        await this.synchronization.synchronize(target);
        await this.jobs.complete(
          claim.jobId,
          claim.leaseToken,
          new Date(now.getTime() + this.refreshSeconds * 1000),
        );
        synchronized += 1;
      } catch (error: unknown) {
        await this.jobs.fail(
          claim.jobId,
          claim.leaseToken,
          new Date(now.getTime() + this.retrySeconds * 1000),
          errorCode(error),
        );
        failed += 1;
      }
    }
    return { claimed: claims.length, synchronized, failed };
  }
}

function parseEvidence(evidence: CustodyBalanceEvidence, decimals: number) {
  try {
    const values = {
      total: toAtomicUnits(evidence.total, decimals),
      available: toAtomicUnits(evidence.available, decimals),
      pending: toAtomicUnits(evidence.pending, decimals),
      frozen: toAtomicUnits(evidence.frozen, decimals),
      locked: toAtomicUnits(evidence.locked, decimals),
    };
    if (Object.values(values).some((value) => value < 0n)) throw new Error('negative');
    return values;
  } catch (error: unknown) {
    if (error instanceof AmountPrecisionError || error instanceof Error) {
      throw new TreasuryEvidenceError('INVALID_PROVIDER_EVIDENCE');
    }
    throw error;
  }
}

function addressMatches(
  target: TreasurySyncTarget,
  addresses: CustodyBalanceEvidence['addresses'],
): boolean {
  return addresses.some(
    (entry) =>
      sameAddress(entry.address, target.publicAddress) &&
      (target.addressTag === undefined || entry.tag === target.addressTag),
  );
}

function sameAddress(providerAddress: string, configuredAddress: string): boolean {
  if (/^0x[0-9a-f]+$/i.test(providerAddress) && /^0x[0-9a-f]+$/i.test(configuredAddress)) {
    return providerAddress.toLowerCase() === configuredAddress.toLowerCase();
  }
  return providerAddress === configuredAddress;
}

function nonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function errorCode(error: unknown): string {
  if (error instanceof TreasuryEvidenceError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)) return error.message;
  return 'TREASURY_SYNC_FAILED';
}
