import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AmountPrecisionError, fromAtomicUnits, toAtomicUnits } from './amount';
import { calculateBuyQuote, QuoteCalculationError, QuoteCalculationFailureCode } from './quote';

export type QuoteCreationFailureCode =
  | QuoteCalculationFailureCode
  | 'MARKET_DISABLED'
  | 'QUOTE_POLICY_UNAVAILABLE'
  | 'REFERENCE_RATE_UNAVAILABLE'
  | 'REFERENCE_RATE_EXPIRED'
  | 'AMOUNT_INVALID'
  | 'AMOUNT_EXCESS_PRECISION';

export class QuoteCreationError extends Error {
  constructor(readonly code: QuoteCreationFailureCode) {
    super(code);
    this.name = 'QuoteCreationError';
  }
}

export interface ReadyQuoteContext {
  readonly marketId: string;
  readonly backingAssetNetworkId: string;
  readonly quoteFiatDecimals: number;
  readonly baseAssetDecimals: number;
  readonly policy: {
    readonly id: string;
    readonly configurationVersionId: number;
    readonly spreadBps: number;
    readonly fixedFeeAtomic: bigint;
    readonly percentageFeeBps: number;
    readonly minTotalDebitAtomic: bigint;
    readonly maxTotalDebitAtomic: bigint;
    readonly quoteTtlSeconds: number;
    readonly rateDisplayScale: number;
  };
  readonly snapshot: {
    readonly id: string;
    readonly rate: string;
    readonly validUntil: Date;
  };
}

export type QuoteContextResult =
  | { readonly kind: 'READY'; readonly context: ReadyQuoteContext }
  | { readonly kind: 'MARKET_UNAVAILABLE' }
  | { readonly kind: 'POLICY_UNAVAILABLE' }
  | { readonly kind: 'REFERENCE_UNAVAILABLE' };

export interface NewStoredQuote {
  readonly id: string;
  readonly side: 'BUY';
  readonly marketId: string;
  readonly backingAssetNetworkId: string;
  readonly referenceRateSnapshotId: string;
  readonly quotePolicyVersionId: string;
  readonly configurationVersionId: number;
  readonly totalDebitAtomic: bigint;
  readonly fixedFeeAtomic: bigint;
  readonly percentageFeeAtomic: bigint;
  readonly percentageFeeBps: number;
  readonly totalFeeAtomic: bigint;
  readonly tradeAmountAtomic: bigint;
  readonly spreadBps: number;
  readonly spreadAmountAtomic: bigint;
  readonly destinationAmountAtomic: bigint;
  readonly quoteFiatDecimals: number;
  readonly baseAssetDecimals: number;
  readonly referenceRate: string;
  readonly customerRate: string;
  readonly rateDisplayScale: number;
  readonly feeRoundingMode: 'CEILING';
  readonly destinationRoundingMode: 'FLOOR';
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export abstract class QuoteRepository {
  abstract loadCreationContext(marketId: string, at: Date): Promise<QuoteContextResult>;
  abstract insertQuote(quote: NewStoredQuote): Promise<void>;
}

export interface CreateBuyQuoteRequest {
  readonly marketId: string;
  readonly debitAmount: string;
}

export interface BuyQuoteView {
  readonly quoteId: string;
  readonly side: 'BUY';
  readonly marketId: string;
  readonly debitAmount: string;
  readonly tradeAmount: string;
  readonly fixedFeeAmount: string;
  readonly percentageFeeAmount: string;
  readonly totalFeeAmount: string;
  readonly referenceRate: string;
  readonly customerRate: string;
  readonly spreadAmount: string;
  readonly destinationAmount: string;
  readonly expiresAt: string;
  readonly configurationVersion: number;
}

@Injectable()
export class QuoteService {
  constructor(
    private readonly repository: QuoteRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async createBuyQuote(request: CreateBuyQuoteRequest): Promise<BuyQuoteView> {
    const createdAt = this.clock();
    if (!isValidDate(createdAt) || request.marketId.length === 0) {
      throw new QuoteCreationError('QUOTE_INPUT_INVALID');
    }
    const result = await this.repository.loadCreationContext(request.marketId, createdAt);
    if (result.kind !== 'READY') throw contextError(result.kind);
    const { context } = result;
    if (context.snapshot.validUntil.getTime() <= createdAt.getTime()) {
      throw new QuoteCreationError('REFERENCE_RATE_EXPIRED');
    }

    let totalDebitAtomic: bigint;
    try {
      totalDebitAtomic = toAtomicUnits(request.debitAmount, context.quoteFiatDecimals);
    } catch (error: unknown) {
      if (!(error instanceof AmountPrecisionError)) throw error;
      throw new QuoteCreationError(
        error.message.includes('exceeds') ? 'AMOUNT_EXCESS_PRECISION' : 'AMOUNT_INVALID',
      );
    }

    let calculation;
    try {
      calculation = calculateBuyQuote({
        totalDebitAtomic,
        minTotalDebitAtomic: context.policy.minTotalDebitAtomic,
        maxTotalDebitAtomic: context.policy.maxTotalDebitAtomic,
        fixedFeeAtomic: context.policy.fixedFeeAtomic,
        percentageFeeBps: context.policy.percentageFeeBps,
        spreadBps: context.policy.spreadBps,
        quoteFiatDecimals: context.quoteFiatDecimals,
        baseAssetDecimals: context.baseAssetDecimals,
        referenceRate: context.snapshot.rate,
        rateDisplayScale: context.policy.rateDisplayScale,
      });
    } catch (error: unknown) {
      if (error instanceof QuoteCalculationError) throw new QuoteCreationError(error.code);
      throw error;
    }

    const policyExpiry = new Date(createdAt.getTime() + context.policy.quoteTtlSeconds * 1000);
    const expiresAt = new Date(
      Math.min(policyExpiry.getTime(), context.snapshot.validUntil.getTime()),
    );
    const quoteId = randomUUID();
    await this.repository.insertQuote({
      id: quoteId,
      side: 'BUY',
      marketId: context.marketId,
      backingAssetNetworkId: context.backingAssetNetworkId,
      referenceRateSnapshotId: context.snapshot.id,
      quotePolicyVersionId: context.policy.id,
      configurationVersionId: context.policy.configurationVersionId,
      ...calculation,
      quoteFiatDecimals: context.quoteFiatDecimals,
      baseAssetDecimals: context.baseAssetDecimals,
      referenceRate: context.snapshot.rate,
      customerRate: calculation.customerRate,
      rateDisplayScale: context.policy.rateDisplayScale,
      expiresAt,
      createdAt,
    });

    return {
      quoteId,
      side: 'BUY',
      marketId: context.marketId,
      debitAmount: fromAtomicUnits(calculation.totalDebitAtomic, context.quoteFiatDecimals),
      tradeAmount: fromAtomicUnits(calculation.tradeAmountAtomic, context.quoteFiatDecimals),
      fixedFeeAmount: fromAtomicUnits(calculation.fixedFeeAtomic, context.quoteFiatDecimals),
      percentageFeeAmount: fromAtomicUnits(
        calculation.percentageFeeAtomic,
        context.quoteFiatDecimals,
      ),
      totalFeeAmount: fromAtomicUnits(calculation.totalFeeAtomic, context.quoteFiatDecimals),
      referenceRate: context.snapshot.rate,
      customerRate: calculation.customerRateDisplay,
      spreadAmount: fromAtomicUnits(calculation.spreadAmountAtomic, context.quoteFiatDecimals),
      destinationAmount: fromAtomicUnits(
        calculation.destinationAmountAtomic,
        context.baseAssetDecimals,
      ),
      expiresAt: expiresAt.toISOString(),
      configurationVersion: context.policy.configurationVersionId,
    };
  }
}

function contextError(kind: Exclude<QuoteContextResult['kind'], 'READY'>): QuoteCreationError {
  const codes = {
    MARKET_UNAVAILABLE: 'MARKET_DISABLED',
    POLICY_UNAVAILABLE: 'QUOTE_POLICY_UNAVAILABLE',
    REFERENCE_UNAVAILABLE: 'REFERENCE_RATE_UNAVAILABLE',
  } as const;
  return new QuoteCreationError(codes[kind]);
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}
