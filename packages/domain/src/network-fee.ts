import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { fromAtomicUnits, toAtomicUnits } from './amount';

const BASIS_POINTS = 10_000n;
const MAX_BIGINT = 9_223_372_036_854_775_807n;

export type NetworkTransferType = 'NATIVE' | 'TOKEN';
export type FeeObservationSource = 'PROVIDER' | 'RPC';

export interface FeeObservationValue {
  readonly source: FeeObservationSource;
  readonly estimatedNativeFeeAtomic: bigint;
  readonly observedAt: Date;
  readonly expiresAt: Date;
  readonly safeReference?: string;
}

export interface NetworkFeeCalculationInput {
  readonly observations: readonly FeeObservationValue[];
  readonly requiredObservations: number;
  readonly maxDeviationBps: number;
  readonly percentageBufferBps: number;
  readonly fixedBufferAtomic: bigint;
  readonly conversionNumerator: bigint;
  readonly conversionDenominator: bigint;
  readonly now: Date;
}

export interface NetworkFeeCalculation {
  readonly estimatedNativeFeeAtomic: bigint;
  readonly percentageBufferAtomic: bigint;
  readonly fixedBufferAtomic: bigint;
  readonly bufferedNativeFeeAtomic: bigint;
  readonly chargedNetworkFeeAtomic: bigint;
  readonly deviationBps: number;
  readonly roundingMode: 'CEILING';
}

export type NetworkFeeCalculationFailure =
  | 'FEE_INPUT_INVALID'
  | 'FEE_OBSERVATIONS_MISSING'
  | 'FEE_OBSERVATION_EXPIRED'
  | 'FEE_OBSERVATION_SOURCES_DUPLICATED'
  | 'FEE_ESTIMATE_DEVIATION_EXCEEDED'
  | 'FEE_AMOUNT_OVERFLOW';

export class NetworkFeeCalculationError extends Error {
  constructor(readonly code: NetworkFeeCalculationFailure) {
    super(code);
    this.name = 'NetworkFeeCalculationError';
  }
}

export function calculateNetworkFee(input: NetworkFeeCalculationInput): NetworkFeeCalculation {
  validateCalculationInput(input);
  if (input.observations.length < input.requiredObservations) {
    throw new NetworkFeeCalculationError('FEE_OBSERVATIONS_MISSING');
  }
  if (
    input.observations.some((observation) => observation.expiresAt.getTime() <= input.now.getTime())
  ) {
    throw new NetworkFeeCalculationError('FEE_OBSERVATION_EXPIRED');
  }
  const sources = new Set(input.observations.map((observation) => observation.source));
  if (sources.size !== input.observations.length) {
    throw new NetworkFeeCalculationError('FEE_OBSERVATION_SOURCES_DUPLICATED');
  }

  const estimates = input.observations.map((observation) => observation.estimatedNativeFeeAtomic);
  const minimum = estimates.reduce((left, right) => (left < right ? left : right));
  const maximum = estimates.reduce((left, right) => (left > right ? left : right));
  const deviationBps = Number(divideCeiling((maximum - minimum) * BASIS_POINTS, minimum));
  if (deviationBps > input.maxDeviationBps) {
    throw new NetworkFeeCalculationError('FEE_ESTIMATE_DEVIATION_EXCEEDED');
  }

  const percentageBufferAtomic = divideCeiling(
    maximum * BigInt(input.percentageBufferBps),
    BASIS_POINTS,
  );
  const bufferedNativeFeeAtomic = maximum + percentageBufferAtomic + input.fixedBufferAtomic;
  const chargedNetworkFeeAtomic = divideCeiling(
    bufferedNativeFeeAtomic * input.conversionNumerator,
    input.conversionDenominator,
  );
  assertFitsDatabase([percentageBufferAtomic, bufferedNativeFeeAtomic, chargedNetworkFeeAtomic]);
  return {
    estimatedNativeFeeAtomic: maximum,
    percentageBufferAtomic,
    fixedBufferAtomic: input.fixedBufferAtomic,
    bufferedNativeFeeAtomic,
    chargedNetworkFeeAtomic,
    deviationBps,
    roundingMode: 'CEILING',
  };
}

export interface WithdrawalFeeQuoteCalculationInput {
  readonly principalAtomic: bigint;
  readonly minPrincipalAtomic: bigint;
  readonly maxPrincipalAtomic: bigint;
  readonly chargedNetworkFeeAtomic: bigint;
  readonly fixedServiceFeeAtomic: bigint;
  readonly percentageServiceFeeBps: number;
}

export interface WithdrawalFeeQuoteCalculation {
  readonly principalAtomic: bigint;
  readonly networkFeeAtomic: bigint;
  readonly fixedServiceFeeAtomic: bigint;
  readonly percentageServiceFeeAtomic: bigint;
  readonly serviceFeeAtomic: bigint;
  readonly totalDebitAtomic: bigint;
  readonly recipientAmountAtomic: bigint;
  readonly roundingMode: 'CEILING';
}

export type WithdrawalFeeQuoteFailure =
  | 'WITHDRAWAL_FEE_INPUT_INVALID'
  | 'WITHDRAWAL_BELOW_MINIMUM'
  | 'WITHDRAWAL_ABOVE_MAXIMUM'
  | 'WITHDRAWAL_FEE_AMOUNT_OVERFLOW';

export class WithdrawalFeeQuoteCalculationError extends Error {
  constructor(readonly code: WithdrawalFeeQuoteFailure) {
    super(code);
    this.name = 'WithdrawalFeeQuoteCalculationError';
  }
}

export function calculateWithdrawalFeeQuote(
  input: WithdrawalFeeQuoteCalculationInput,
): WithdrawalFeeQuoteCalculation {
  if (
    input.principalAtomic <= 0n ||
    input.minPrincipalAtomic <= 0n ||
    input.maxPrincipalAtomic < input.minPrincipalAtomic ||
    input.chargedNetworkFeeAtomic < 0n ||
    input.fixedServiceFeeAtomic < 0n ||
    !isBps(input.percentageServiceFeeBps)
  ) {
    throw new WithdrawalFeeQuoteCalculationError('WITHDRAWAL_FEE_INPUT_INVALID');
  }
  if (input.principalAtomic < input.minPrincipalAtomic) {
    throw new WithdrawalFeeQuoteCalculationError('WITHDRAWAL_BELOW_MINIMUM');
  }
  if (input.principalAtomic > input.maxPrincipalAtomic) {
    throw new WithdrawalFeeQuoteCalculationError('WITHDRAWAL_ABOVE_MAXIMUM');
  }
  const percentageServiceFeeAtomic = divideCeiling(
    input.principalAtomic * BigInt(input.percentageServiceFeeBps),
    BASIS_POINTS,
  );
  const serviceFeeAtomic = input.fixedServiceFeeAtomic + percentageServiceFeeAtomic;
  const totalDebitAtomic = input.principalAtomic + input.chargedNetworkFeeAtomic + serviceFeeAtomic;
  try {
    assertFitsDatabase([percentageServiceFeeAtomic, serviceFeeAtomic, totalDebitAtomic]);
  } catch {
    throw new WithdrawalFeeQuoteCalculationError('WITHDRAWAL_FEE_AMOUNT_OVERFLOW');
  }
  return {
    principalAtomic: input.principalAtomic,
    networkFeeAtomic: input.chargedNetworkFeeAtomic,
    fixedServiceFeeAtomic: input.fixedServiceFeeAtomic,
    percentageServiceFeeAtomic,
    serviceFeeAtomic,
    totalDebitAtomic,
    recipientAmountAtomic: input.principalAtomic,
    roundingMode: 'CEILING',
  };
}

function validateCalculationInput(input: NetworkFeeCalculationInput): void {
  if (
    !Number.isInteger(input.requiredObservations) ||
    input.requiredObservations < 1 ||
    input.requiredObservations > 2 ||
    !isBps(input.maxDeviationBps) ||
    !isBps(input.percentageBufferBps) ||
    input.fixedBufferAtomic < 0n ||
    input.conversionNumerator <= 0n ||
    input.conversionDenominator <= 0n ||
    input.observations.length < 1 ||
    input.observations.length > 2 ||
    input.observations.some(
      (observation) =>
        observation.estimatedNativeFeeAtomic <= 0n ||
        observation.estimatedNativeFeeAtomic > MAX_BIGINT ||
        observation.observedAt.getTime() > input.now.getTime(),
    )
  ) {
    throw new NetworkFeeCalculationError('FEE_INPUT_INVALID');
  }
}

function isBps(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 10_000;
}

function divideCeiling(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function assertFitsDatabase(values: readonly bigint[]): void {
  if (values.some((value) => value < 0n || value > MAX_BIGINT)) {
    throw new NetworkFeeCalculationError('FEE_AMOUNT_OVERFLOW');
  }
}

export interface NetworkFeePolicyContext {
  readonly policyId: string;
  readonly assetNetworkId: string;
  readonly transferType: NetworkTransferType;
  readonly nativeFeeAssetId: string;
  readonly chargeAssetId: string;
  readonly requiredObservations: number;
  readonly maxDeviationBps: number;
  readonly percentageBufferBps: number;
  readonly fixedBufferAtomic: bigint;
  readonly observationTtlSeconds: number;
  readonly snapshotTtlSeconds: number;
  readonly conversionEvidenceId?: string;
  readonly conversionNumerator: bigint;
  readonly conversionDenominator: bigint;
}

export interface StoredNetworkFeeSnapshot {
  readonly id: string;
  readonly policyId: string;
  readonly assetNetworkId: string;
  readonly status: 'ACCEPTED' | 'REJECTED';
  readonly rejectionReason?: NetworkFeeCalculationFailure | 'FEE_REFRESH_FAILED';
  readonly calculation?: NetworkFeeCalculation;
  readonly calculatedAt: Date;
  readonly expiresAt?: Date;
}

export interface WithdrawalFeeQuoteContext {
  readonly assetNetworkId: string;
  readonly transferType: NetworkTransferType;
  readonly assetDecimals: number;
  readonly nativeFeeAssetDecimals: number;
  readonly minPrincipalAtomic: bigint;
  readonly maxPrincipalAtomic: bigint;
  readonly fixedServiceFeeAtomic: bigint;
  readonly percentageServiceFeeBps: number;
  readonly quoteTtlSeconds: number;
  readonly snapshot: StoredNetworkFeeSnapshot & { readonly calculation: NetworkFeeCalculation };
}

export interface StoredWithdrawalFeeQuote extends WithdrawalFeeQuoteCalculation {
  readonly id: string;
  readonly assetNetworkId: string;
  readonly transferType: NetworkTransferType;
  readonly feeSnapshotId: string;
  readonly customerReference: string;
  readonly destinationAddress: string;
  readonly assetDecimals: number;
  readonly nativeFeeAssetDecimals: number;
  readonly estimatedNativeFeeAtomic: bigint;
  readonly bufferedNativeFeeAtomic: bigint;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export abstract class NetworkFeeRepository {
  abstract loadPolicy(policyId: string, now: Date): Promise<NetworkFeePolicyContext | null>;
  abstract saveRefresh(input: {
    readonly policy: NetworkFeePolicyContext;
    readonly observations: readonly FeeObservationValue[];
    readonly calculation?: NetworkFeeCalculation;
    readonly rejectionReason?: NetworkFeeCalculationFailure | 'FEE_REFRESH_FAILED';
    readonly calculatedAt: Date;
  }): Promise<StoredNetworkFeeSnapshot>;
  abstract loadQuoteContext(
    assetNetworkId: string,
    transferType: NetworkTransferType,
    now: Date,
  ): Promise<WithdrawalFeeQuoteContext | null>;
  abstract insertQuote(
    input: Omit<StoredWithdrawalFeeQuote, 'id'>,
  ): Promise<StoredWithdrawalFeeQuote>;
}

export interface NetworkFeeEstimateRequest {
  readonly policyId: string;
  readonly assetNetworkId: string;
  readonly transferType: NetworkTransferType;
  readonly source: FeeObservationSource;
  readonly now: Date;
}

export abstract class NetworkFeeEstimator {
  abstract estimate(input: NetworkFeeEstimateRequest): Promise<{
    readonly estimatedNativeFeeAtomic: bigint;
    readonly observedAt: Date;
    readonly safeReference?: string;
  }>;
}

export abstract class NetworkFeeEstimatorResolver {
  abstract resolve(source: FeeObservationSource): NetworkFeeEstimator;
}

@Injectable()
export class NetworkFeeRefreshService {
  constructor(
    private readonly repository: NetworkFeeRepository,
    private readonly estimators: NetworkFeeEstimatorResolver,
  ) {}

  async refresh(policyId: string, now = new Date()): Promise<StoredNetworkFeeSnapshot> {
    const policy = await this.repository.loadPolicy(policyId, now);
    if (!policy) throw new Error('NETWORK_FEE_POLICY_NOT_FOUND');
    const sources: readonly FeeObservationSource[] =
      policy.requiredObservations === 2 ? ['PROVIDER', 'RPC'] : ['PROVIDER'];
    try {
      const results = await Promise.all(
        sources.map(async (source) => ({
          source,
          ...(await this.estimators.resolve(source).estimate({
            policyId,
            assetNetworkId: policy.assetNetworkId,
            transferType: policy.transferType,
            source,
            now,
          })),
        })),
      );
      const observations = results.map((result) => ({
        ...result,
        expiresAt: new Date(result.observedAt.getTime() + policy.observationTtlSeconds * 1000),
      }));
      try {
        const calculation = calculateNetworkFee({ ...policy, observations, now });
        return this.repository.saveRefresh({
          policy,
          observations,
          calculation,
          calculatedAt: now,
        });
      } catch (error: unknown) {
        if (!(error instanceof NetworkFeeCalculationError)) throw error;
        return this.repository.saveRefresh({
          policy,
          observations,
          rejectionReason: error.code,
          calculatedAt: now,
        });
      }
    } catch {
      return this.repository.saveRefresh({
        policy,
        observations: [],
        rejectionReason: 'FEE_REFRESH_FAILED',
        calculatedAt: now,
      });
    }
  }
}

export type WithdrawalFeeQuoteServiceFailure =
  WithdrawalFeeQuoteFailure | 'NETWORK_FEE_ROUTE_UNAVAILABLE' | 'NETWORK_FEE_SNAPSHOT_EXPIRED';

export class WithdrawalFeeQuoteError extends Error {
  constructor(readonly code: WithdrawalFeeQuoteServiceFailure) {
    super(code);
    this.name = 'WithdrawalFeeQuoteError';
  }
}

export interface WithdrawalFeeQuoteView {
  readonly feeQuoteId: string;
  readonly assetNetworkId: string;
  readonly transferType: NetworkTransferType;
  readonly principal: string;
  readonly estimatedNativeFee: string;
  readonly bufferedNativeFee: string;
  readonly networkFee: string;
  readonly serviceFee: string;
  readonly totalDebit: string;
  readonly recipientAmount: string;
  readonly expiresAt: string;
}

@Injectable()
export class WithdrawalFeeQuoteService {
  constructor(
    private readonly repository: NetworkFeeRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async create(input: {
    assetNetworkId: string;
    transferType: NetworkTransferType;
    amount: string;
    destinationAddress: string;
    customerReference: string;
  }): Promise<WithdrawalFeeQuoteView> {
    const now = this.clock();
    const context = await this.repository.loadQuoteContext(
      input.assetNetworkId,
      input.transferType,
      now,
    );
    if (!context) throw new WithdrawalFeeQuoteError('NETWORK_FEE_ROUTE_UNAVAILABLE');
    if (!context.snapshot.expiresAt || context.snapshot.expiresAt.getTime() <= now.getTime()) {
      throw new WithdrawalFeeQuoteError('NETWORK_FEE_SNAPSHOT_EXPIRED');
    }
    try {
      const calculation = calculateWithdrawalFeeQuote({
        principalAtomic: toAtomicUnits(input.amount, context.assetDecimals),
        minPrincipalAtomic: context.minPrincipalAtomic,
        maxPrincipalAtomic: context.maxPrincipalAtomic,
        chargedNetworkFeeAtomic: context.snapshot.calculation.chargedNetworkFeeAtomic,
        fixedServiceFeeAtomic: context.fixedServiceFeeAtomic,
        percentageServiceFeeBps: context.percentageServiceFeeBps,
      });
      const stored = await this.repository.insertQuote({
        ...calculation,
        assetNetworkId: input.assetNetworkId,
        transferType: input.transferType,
        feeSnapshotId: context.snapshot.id,
        customerReference: input.customerReference,
        destinationAddress: input.destinationAddress,
        assetDecimals: context.assetDecimals,
        nativeFeeAssetDecimals: context.nativeFeeAssetDecimals,
        estimatedNativeFeeAtomic: context.snapshot.calculation.estimatedNativeFeeAtomic,
        bufferedNativeFeeAtomic: context.snapshot.calculation.bufferedNativeFeeAtomic,
        expiresAt: new Date(now.getTime() + context.quoteTtlSeconds * 1000),
        createdAt: now,
      });
      return quoteView(stored);
    } catch (error: unknown) {
      if (error instanceof WithdrawalFeeQuoteCalculationError) {
        throw new WithdrawalFeeQuoteError(error.code);
      }
      throw error;
    }
  }
}

export function networkFeeDeduplicationKey(
  policyId: string,
  observation: FeeObservationValue,
): string {
  return createHash('sha256')
    .update(
      `${policyId}|${observation.source}|${observation.estimatedNativeFeeAtomic}|${observation.observedAt.toISOString()}|${observation.safeReference ?? ''}`,
    )
    .digest('hex');
}

function quoteView(quote: StoredWithdrawalFeeQuote): WithdrawalFeeQuoteView {
  return {
    feeQuoteId: quote.id,
    assetNetworkId: quote.assetNetworkId,
    transferType: quote.transferType,
    principal: fromAtomicUnits(quote.principalAtomic, quote.assetDecimals),
    estimatedNativeFee: fromAtomicUnits(
      quote.estimatedNativeFeeAtomic,
      quote.nativeFeeAssetDecimals,
    ),
    bufferedNativeFee: fromAtomicUnits(quote.bufferedNativeFeeAtomic, quote.nativeFeeAssetDecimals),
    networkFee: fromAtomicUnits(quote.networkFeeAtomic, quote.assetDecimals),
    serviceFee: fromAtomicUnits(quote.serviceFeeAtomic, quote.assetDecimals),
    totalDebit: fromAtomicUnits(quote.totalDebitAtomic, quote.assetDecimals),
    recipientAmount: fromAtomicUnits(quote.recipientAmountAtomic, quote.assetDecimals),
    expiresAt: quote.expiresAt.toISOString(),
  };
}

export interface ClaimedNetworkFeeRefreshJob {
  readonly id: string;
  readonly policyId: string;
  readonly refreshIntervalSeconds: number;
  readonly attemptCount: number;
  readonly leaseToken: string;
}

export abstract class NetworkFeeRefreshJobRepository {
  abstract claimBatch(input: {
    readonly limit: number;
    readonly leaseSeconds: number;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<readonly ClaimedNetworkFeeRefreshJob[]>;
  abstract complete(jobId: string, leaseToken: string, nextRefreshAt: Date): Promise<void>;
  abstract fail(
    jobId: string,
    leaseToken: string,
    errorCode: string,
    nextRefreshAt: Date,
  ): Promise<void>;
}

@Injectable()
export class NetworkFeeRefreshBatchService {
  constructor(
    private readonly jobs: NetworkFeeRefreshJobRepository,
    private readonly refresh: NetworkFeeRefreshService,
    private readonly batchSize = 10,
    private readonly leaseSeconds = 30,
    private readonly retrySeconds = 10,
  ) {}

  async processBatch(
    now: Date,
    leaseToken: string,
  ): Promise<{ claimed: number; accepted: number; rejected: number; failed: number }> {
    const claims = await this.jobs.claimBatch({
      limit: this.batchSize,
      leaseSeconds: this.leaseSeconds,
      leaseToken,
      now,
    });
    let accepted = 0;
    let rejected = 0;
    let failed = 0;
    for (const job of claims) {
      try {
        const snapshot = await this.refresh.refresh(job.policyId, now);
        if (snapshot.status === 'ACCEPTED') accepted += 1;
        else rejected += 1;
        await this.jobs.complete(
          job.id,
          job.leaseToken,
          new Date(now.getTime() + job.refreshIntervalSeconds * 1000),
        );
      } catch {
        failed += 1;
        await this.jobs.fail(
          job.id,
          job.leaseToken,
          'NETWORK_FEE_REFRESH_FAILED',
          new Date(now.getTime() + this.retrySeconds * 1000),
        );
      }
    }
    return { claimed: claims.length, accepted, rejected, failed };
  }
}
