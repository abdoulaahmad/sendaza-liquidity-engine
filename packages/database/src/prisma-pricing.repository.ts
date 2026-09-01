import { Injectable } from '@nestjs/common';
import {
  ConversionRouteDefinition,
  NewPriceObservation,
  PreviousAcceptedRate,
  PricingRepository,
  ReferenceRateEvaluation,
  StoredPriceObservation,
} from '../../domain/src';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaPricingRepository implements PricingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findEnabledRoute(marketId: string): Promise<ConversionRouteDefinition | null> {
    const route = await this.prisma.conversionRoute.findFirst({
      where: { marketId, status: 'ENABLED' },
      select: {
        id: true,
        version: true,
        outputScale: true,
        maxAgeSeconds: true,
        maxDeviationBps: true,
        stablecoinGuardPairId: true,
        stablecoinExpectedRate: true,
        stablecoinToleranceBps: true,
        legs: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            sequence: true,
            providerPricePairId: true,
            operation: true,
          },
        },
      },
    });
    if (!route) return null;

    return {
      id: route.id,
      version: route.version,
      outputScale: route.outputScale,
      maxAgeSeconds: route.maxAgeSeconds,
      maxDeviationBps: route.maxDeviationBps,
      legs: route.legs.map((leg) => ({
        id: leg.id,
        sequence: leg.sequence,
        providerPairId: leg.providerPricePairId,
        operation: leg.operation,
      })),
      ...(route.stablecoinGuardPairId &&
      route.stablecoinExpectedRate !== null &&
      route.stablecoinToleranceBps !== null
        ? {
            stablecoinGuard: {
              providerPairId: route.stablecoinGuardPairId,
              expectedRate: route.stablecoinExpectedRate.toFixed(),
              toleranceBps: route.stablecoinToleranceBps,
            },
          }
        : {}),
    };
  }

  async findLatestObservations(
    providerPairIds: readonly string[],
  ): Promise<readonly StoredPriceObservation[]> {
    if (providerPairIds.length === 0) return [];
    const observations = await this.prisma.priceObservation.findMany({
      where: { providerPricePairId: { in: [...new Set(providerPairIds)] } },
      orderBy: [{ providerPricePairId: 'asc' }, { providerObservedAt: 'desc' }],
      distinct: ['providerPricePairId'],
      select: {
        id: true,
        providerPricePairId: true,
        normalizedRate: true,
        providerObservedAt: true,
        providerSequence: true,
        providerPricePair: { select: { priceScale: true, maxAgeSeconds: true } },
      },
    });
    return observations.map((observation) => ({
      id: observation.id,
      providerPairId: observation.providerPricePairId,
      rate: observation.normalizedRate.toFixed(),
      priceScale: observation.providerPricePair.priceScale,
      pairMaxAgeSeconds: observation.providerPricePair.maxAgeSeconds,
      observedAt: observation.providerObservedAt,
    }));
  }

  async findPreviousAcceptedRate(routeId: string): Promise<PreviousAcceptedRate | null> {
    const snapshot = await this.prisma.referenceRateSnapshot.findFirst({
      where: { routeId, status: 'ACCEPTED', rate: { not: null } },
      orderBy: { calculatedAt: 'desc' },
      select: { rate: true },
    });
    return snapshot?.rate ? { rate: snapshot.rate.toFixed() } : null;
  }

  async insertObservation(observation: NewPriceObservation): Promise<string> {
    const created = await this.prisma.priceObservation.create({
      data: {
        providerPricePairId: observation.providerPairId,
        normalizedRate: observation.normalizedRate,
        rawRate: observation.rawRate,
        providerObservedAt: observation.providerObservedAt,
        deduplicationKey: observation.deduplicationKey,
        receivedAt: observation.receivedAt,
        ...(observation.providerSequence
          ? { providerSequence: observation.providerSequence }
          : {}),
        ...(observation.safeProviderReference
          ? { safeProviderReference: observation.safeProviderReference }
          : {}),
      },
      select: { id: true },
    });
    return created.id;
  }

  async saveEvaluation(evaluation: ReferenceRateEvaluation): Promise<string> {
    return this.prisma.$transaction(async (transaction) => {
      const snapshot = await transaction.referenceRateSnapshot.create({
        data: {
          routeId: evaluation.routeId,
          outputScale: evaluation.outputScale,
          roundingMode: evaluation.roundingMode,
          status: evaluation.status,
          calculatedAt: evaluation.calculatedAt,
          ...(evaluation.guardObservationId
            ? { guardObservationId: evaluation.guardObservationId }
            : {}),
          ...(evaluation.status === 'ACCEPTED'
            ? { rate: evaluation.rate, validUntil: evaluation.validUntil }
            : { rejectionReason: evaluation.failureCode }),
        },
        select: { id: true },
      });
      if (evaluation.inputs.length > 0) {
        await transaction.referenceRateSnapshotInput.createMany({
          data: evaluation.inputs.map((input) => ({
            snapshotId: snapshot.id,
            routeLegId: input.routeLegId,
            observationId: input.observationId,
          })),
        });
      }
      return snapshot.id;
    });
  }
}
