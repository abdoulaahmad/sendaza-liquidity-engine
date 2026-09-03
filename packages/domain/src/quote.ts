import Decimal from 'decimal.js';

const RATE_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const BASIS_POINT_DENOMINATOR = 10_000n;
const MAX_DATABASE_BIGINT = 9_223_372_036_854_775_807n;
const QuoteDecimal = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_HALF_EVEN });

export const QUOTE_CALCULATION_FAILURE_CODES = [
  'QUOTE_INPUT_INVALID',
  'ORDER_BELOW_MINIMUM',
  'ORDER_ABOVE_MAXIMUM',
  'FEES_EXCEED_DEBIT',
  'DESTINATION_AMOUNT_TOO_SMALL',
  'QUOTE_AMOUNT_OVERFLOW',
] as const;

export type QuoteCalculationFailureCode = (typeof QUOTE_CALCULATION_FAILURE_CODES)[number];

export class QuoteCalculationError extends Error {
  constructor(readonly code: QuoteCalculationFailureCode) {
    super(code);
    this.name = 'QuoteCalculationError';
  }
}

export interface QuoteCalculationInput {
  readonly totalDebitAtomic: bigint;
  readonly minTotalDebitAtomic: bigint;
  readonly maxTotalDebitAtomic: bigint;
  readonly fixedFeeAtomic: bigint;
  readonly percentageFeeBps: number;
  readonly spreadBps: number;
  readonly quoteFiatDecimals: number;
  readonly baseAssetDecimals: number;
  readonly referenceRate: string;
  readonly rateDisplayScale: number;
}

export interface QuoteCalculation {
  readonly totalDebitAtomic: bigint;
  readonly fixedFeeAtomic: bigint;
  readonly percentageFeeAtomic: bigint;
  readonly totalFeeAtomic: bigint;
  readonly tradeAmountAtomic: bigint;
  readonly destinationAmountAtomic: bigint;
  readonly spreadAmountAtomic: bigint;
  readonly percentageFeeBps: number;
  readonly spreadBps: number;
  readonly referenceRate: string;
  readonly customerRate: string;
  readonly customerRateDisplay: string;
  readonly feeRoundingMode: 'CEILING';
  readonly destinationRoundingMode: 'FLOOR';
}

export function calculateBuyQuote(input: QuoteCalculationInput): QuoteCalculation {
  validateInput(input);
  if (input.totalDebitAtomic < input.minTotalDebitAtomic) {
    throw new QuoteCalculationError('ORDER_BELOW_MINIMUM');
  }
  if (input.totalDebitAtomic > input.maxTotalDebitAtomic) {
    throw new QuoteCalculationError('ORDER_ABOVE_MAXIMUM');
  }

  const percentageFeeAtomic = divideCeiling(
    input.totalDebitAtomic * BigInt(input.percentageFeeBps),
    BASIS_POINT_DENOMINATOR,
  );
  const totalFeeAtomic = input.fixedFeeAtomic + percentageFeeAtomic;
  if (totalFeeAtomic >= input.totalDebitAtomic) {
    throw new QuoteCalculationError('FEES_EXCEED_DEBIT');
  }
  const tradeAmountAtomic = input.totalDebitAtomic - totalFeeAtomic;
  const referenceRate = new QuoteDecimal(input.referenceRate);
  const customerRateDecimal = referenceRate
    .times(BASIS_POINT_DENOMINATOR + BigInt(input.spreadBps))
    .dividedBy(BASIS_POINT_DENOMINATOR);
  const fiatScale = new QuoteDecimal(10).pow(input.quoteFiatDecimals);
  const assetScale = new QuoteDecimal(10).pow(input.baseAssetDecimals);
  const destinationAmountAtomic = BigInt(
    new QuoteDecimal(tradeAmountAtomic.toString())
      .times(assetScale)
      .dividedBy(fiatScale)
      .dividedBy(customerRateDecimal)
      .floor()
      .toFixed(0),
  );
  if (destinationAmountAtomic <= 0n) {
    throw new QuoteCalculationError('DESTINATION_AMOUNT_TOO_SMALL');
  }
  if (destinationAmountAtomic > MAX_DATABASE_BIGINT) {
    throw new QuoteCalculationError('QUOTE_AMOUNT_OVERFLOW');
  }

  const referenceValueAtomic = new QuoteDecimal(destinationAmountAtomic.toString())
    .times(referenceRate)
    .times(fiatScale)
    .dividedBy(assetScale);
  const spreadAmountAtomic = BigInt(
    new QuoteDecimal(tradeAmountAtomic.toString()).minus(referenceValueAtomic).floor().toFixed(0),
  );

  return {
    totalDebitAtomic: input.totalDebitAtomic,
    fixedFeeAtomic: input.fixedFeeAtomic,
    percentageFeeAtomic,
    totalFeeAtomic,
    tradeAmountAtomic,
    destinationAmountAtomic,
    spreadAmountAtomic,
    percentageFeeBps: input.percentageFeeBps,
    spreadBps: input.spreadBps,
    referenceRate: referenceRate.toFixed(),
    customerRate: customerRateDecimal.toFixed(30, Decimal.ROUND_HALF_EVEN),
    customerRateDisplay: customerRateDecimal.toFixed(
      input.rateDisplayScale,
      Decimal.ROUND_HALF_EVEN,
    ),
    feeRoundingMode: 'CEILING',
    destinationRoundingMode: 'FLOOR',
  };
}

function divideCeiling(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function validateInput(input: QuoteCalculationInput): void {
  const atomicValues = [
    input.totalDebitAtomic,
    input.minTotalDebitAtomic,
    input.maxTotalDebitAtomic,
    input.fixedFeeAtomic,
  ];
  if (
    atomicValues.some((value) => value < 0n || value > MAX_DATABASE_BIGINT) ||
    input.minTotalDebitAtomic <= 0n ||
    input.maxTotalDebitAtomic < input.minTotalDebitAtomic ||
    !isBasisPoints(input.percentageFeeBps) ||
    !isBasisPoints(input.spreadBps) ||
    !isScale(input.quoteFiatDecimals, 255) ||
    !isScale(input.baseAssetDecimals, 255) ||
    !isScale(input.rateDisplayScale, 30) ||
    !RATE_PATTERN.test(input.referenceRate) ||
    !new QuoteDecimal(input.referenceRate).greaterThan(0)
  ) {
    throw new QuoteCalculationError('QUOTE_INPUT_INVALID');
  }
}

function isBasisPoints(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 10_000;
}

function isScale(value: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}
