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
