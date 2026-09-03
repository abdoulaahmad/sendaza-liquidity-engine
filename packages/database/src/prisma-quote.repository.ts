import { Injectable } from '@nestjs/common';
import { NewStoredQuote, QuoteContextResult, QuoteRepository } from '../../domain/src';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaQuoteRepository implements QuoteRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadCreationContext(marketId: string, at: Date): Promise<QuoteContextResult> {
    const market = await this.prisma.market.findFirst({
      where: {
        id: marketId,
        status: 'ENABLED',
        baseAsset: { status: 'ENABLED' },
        quoteFiat: { status: 'ENABLED' },
        defaultBackingAssetNetwork: { status: 'ENABLED' },
      },
      select: {
        id: true,
        defaultBackingAssetNetworkId: true,
        baseAsset: { select: { decimals: true } },
        quoteFiat: { select: { decimals: true } },
      },
    });
    if (!market) return { kind: 'MARKET_UNAVAILABLE' };

    const policy = await this.prisma.quotePolicyVersion.findFirst({
      where: {
        marketId,
        status: 'ACTIVE',
        effectiveFrom: { lte: at },
        effectiveUntil: null,
      },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        configurationVersionId: true,
        spreadBps: true,
        fixedFeeAtomic: true,
        percentageFeeBps: true,
        minTotalDebitAtomic: true,
        maxTotalDebitAtomic: true,
        quoteTtlSeconds: true,
        rateDisplayScale: true,
      },
    });
    if (!policy) return { kind: 'POLICY_UNAVAILABLE' };

    const snapshot = await this.prisma.referenceRateSnapshot.findFirst({
      where: {
        status: 'ACCEPTED',
        validUntil: { gt: at },
        route: { marketId, status: 'ENABLED' },
      },
      orderBy: { calculatedAt: 'desc' },
      select: { id: true, rate: true, validUntil: true },
    });
    if (!snapshot?.rate || !snapshot.validUntil) return { kind: 'REFERENCE_UNAVAILABLE' };

    return {
      kind: 'READY',
      context: {
        marketId: market.id,
        backingAssetNetworkId: market.defaultBackingAssetNetworkId,
        quoteFiatDecimals: market.quoteFiat.decimals,
        baseAssetDecimals: market.baseAsset.decimals,
        policy,
        snapshot: {
          id: snapshot.id,
          rate: snapshot.rate.toFixed(),
          validUntil: snapshot.validUntil,
        },
      },
    };
  }

  async insertQuote(quote: NewStoredQuote): Promise<void> {
    await this.prisma.quote.create({
      data: {
        id: quote.id,
        side: quote.side,
        marketId: quote.marketId,
        backingAssetNetworkId: quote.backingAssetNetworkId,
        referenceRateSnapshotId: quote.referenceRateSnapshotId,
        quotePolicyVersionId: quote.quotePolicyVersionId,
        configurationVersionId: quote.configurationVersionId,
        totalDebitAtomic: quote.totalDebitAtomic,
        fixedFeeAtomic: quote.fixedFeeAtomic,
        percentageFeeAtomic: quote.percentageFeeAtomic,
        percentageFeeBps: quote.percentageFeeBps,
        totalFeeAtomic: quote.totalFeeAtomic,
        tradeAmountAtomic: quote.tradeAmountAtomic,
        spreadBps: quote.spreadBps,
        spreadAmountAtomic: quote.spreadAmountAtomic,
        destinationAmountAtomic: quote.destinationAmountAtomic,
        quoteFiatDecimals: quote.quoteFiatDecimals,
        baseAssetDecimals: quote.baseAssetDecimals,
        referenceRate: quote.referenceRate,
        customerRate: quote.customerRate,
        rateDisplayScale: quote.rateDisplayScale,
        feeRoundingMode: quote.feeRoundingMode,
        destinationRoundingMode: quote.destinationRoundingMode,
        expiresAt: quote.expiresAt,
        createdAt: quote.createdAt,
      },
      select: { id: true },
    });
  }
}
