import { Injectable } from '@nestjs/common';
import {
  NetworkFeePolicyContext,
  NetworkFeeRepository,
  StoredNetworkFeeSnapshot,
  StoredWithdrawalFeeQuote,
  WithdrawalFeeQuoteContext,
  networkFeeDeduplicationKey,
} from '../../domain/src';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaNetworkFeeRepository implements NetworkFeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadPolicy(policyId: string, now: Date): Promise<NetworkFeePolicyContext | null> {
    const policy = await this.prisma.networkFeePolicyVersion.findFirst({
      where: { id: policyId, status: 'ACTIVE', effectiveFrom: { lte: now } },
      include: { assetNetwork: { include: { asset: true } }, nativeFeeAsset: true },
    });
    if (!policy || policy.chargeAssetId !== policy.assetNetwork.assetId) return null;
    const conversion =
      policy.nativeFeeAssetId === policy.chargeAssetId
        ? null
        : await this.prisma.feeConversionEvidence.findFirst({
            where: {
              fromAssetId: policy.nativeFeeAssetId,
              toAssetId: policy.chargeAssetId,
              observedAt: { lte: now },
              expiresAt: { gt: now },
            },
            orderBy: { observedAt: 'desc' },
          });
    if (policy.nativeFeeAssetId !== policy.chargeAssetId && !conversion) return null;
    return {
      policyId: policy.id,
      assetNetworkId: policy.assetNetworkId,
      transferType: policy.transferType,
      nativeFeeAssetId: policy.nativeFeeAssetId,
      chargeAssetId: policy.chargeAssetId,
      requiredObservations: policy.requiredObservations,
      maxDeviationBps: policy.maxDeviationBps,
      percentageBufferBps: policy.percentageBufferBps,
      fixedBufferAtomic: policy.fixedBufferAtomic,
      observationTtlSeconds: policy.observationTtlSeconds,
      snapshotTtlSeconds: policy.snapshotTtlSeconds,
      ...(conversion ? { conversionEvidenceId: conversion.id } : {}),
      conversionNumerator: conversion?.numerator ?? 1n,
      conversionDenominator: conversion?.denominator ?? 1n,
    };
  }

  async saveRefresh(
    input: Parameters<NetworkFeeRepository['saveRefresh']>[0],
  ): Promise<StoredNetworkFeeSnapshot> {
    return this.prisma.$transaction(
      async (tx) => {
        const observationIds: string[] = [];
        for (const observation of input.observations) {
          const deduplicationKey = networkFeeDeduplicationKey(input.policy.policyId, observation);
          const existing = await tx.networkFeeObservation.findUnique({
            where: {
              policyId_source_deduplicationKey: {
                policyId: input.policy.policyId,
                source: observation.source,
                deduplicationKey,
              },
            },
          });
          const stored =
            existing ??
            (await tx.networkFeeObservation.create({
              data: {
                policyId: input.policy.policyId,
                source: observation.source,
                estimatedNativeFeeAtomic: observation.estimatedNativeFeeAtomic,
                ...(observation.safeReference ? { safeReference: observation.safeReference } : {}),
                deduplicationKey,
                observedAt: observation.observedAt,
                expiresAt: observation.expiresAt,
              },
            }));
          observationIds.push(stored.id);
        }
        const accepted = input.calculation !== undefined;
        const snapshot = await tx.networkFeeSnapshot.create({
          data: {
            policyId: input.policy.policyId,
            status: accepted ? 'ACCEPTED' : 'REJECTED',
            ...(!accepted && input.rejectionReason
              ? { rejectionReason: input.rejectionReason }
              : {}),
            ...(input.calculation
              ? {
                  estimatedNativeFeeAtomic: input.calculation.estimatedNativeFeeAtomic,
                  percentageBufferAtomic: input.calculation.percentageBufferAtomic,
                  bufferedNativeFeeAtomic: input.calculation.bufferedNativeFeeAtomic,
                  chargedNetworkFeeAtomic: input.calculation.chargedNetworkFeeAtomic,
                  deviationBps: input.calculation.deviationBps,
                  conversionNumerator: input.policy.conversionNumerator,
                  conversionDenominator: input.policy.conversionDenominator,
                  ...(input.policy.conversionEvidenceId
                    ? { conversionEvidenceId: input.policy.conversionEvidenceId }
                    : {}),
                  expiresAt: new Date(
                    input.calculatedAt.getTime() + input.policy.snapshotTtlSeconds * 1000,
                  ),
                }
              : {}),
            fixedBufferAtomic: input.policy.fixedBufferAtomic,
            calculatedAt: input.calculatedAt,
            inputs: {
              create: observationIds.map((observationId) => ({ observationId })),
            },
          },
        });
        return {
          id: snapshot.id,
          policyId: snapshot.policyId,
          assetNetworkId: input.policy.assetNetworkId,
          status: snapshot.status,
          ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
          ...(input.calculation ? { calculation: input.calculation } : {}),
          calculatedAt: snapshot.calculatedAt,
          ...(snapshot.expiresAt ? { expiresAt: snapshot.expiresAt } : {}),
        };
      },
      { maxWait: 15_000, timeout: 15_000 },
    );
  }

  async loadQuoteContext(
    assetNetworkId: string,
    transferType: 'NATIVE' | 'TOKEN',
    now: Date,
  ): Promise<WithdrawalFeeQuoteContext | null> {
    const policy = await this.prisma.networkFeePolicyVersion.findFirst({
      where: {
        assetNetworkId,
        transferType,
        status: 'ACTIVE',
        effectiveFrom: { lte: now },
      },
      orderBy: { version: 'desc' },
      include: {
        assetNetwork: { include: { asset: true } },
        nativeFeeAsset: true,
        snapshots: {
          where: { status: 'ACCEPTED', expiresAt: { gt: now } },
          orderBy: { calculatedAt: 'desc' },
          take: 1,
        },
      },
    });
    const snapshot = policy?.snapshots[0];
    if (
      !policy ||
      !snapshot ||
      policy.chargeAssetId !== policy.assetNetwork.assetId ||
      snapshot.estimatedNativeFeeAtomic === null ||
      snapshot.percentageBufferAtomic === null ||
      snapshot.bufferedNativeFeeAtomic === null ||
      snapshot.chargedNetworkFeeAtomic === null ||
      snapshot.deviationBps === null ||
      snapshot.expiresAt === null
    ) {
      return null;
    }
    return {
      assetNetworkId,
      transferType,
      assetDecimals: policy.assetNetwork.asset.decimals,
      nativeFeeAssetDecimals: policy.nativeFeeAsset.decimals,
      minPrincipalAtomic: policy.assetNetwork.minWithdrawalAtomic ?? 1n,
      maxPrincipalAtomic: policy.assetNetwork.maxWithdrawalAtomic ?? 9_223_372_036_854_775_807n,
      fixedServiceFeeAtomic: policy.fixedServiceFeeAtomic,
      percentageServiceFeeBps: policy.percentageServiceFeeBps,
      quoteTtlSeconds: policy.quoteTtlSeconds,
      snapshot: {
        id: snapshot.id,
        policyId: policy.id,
        assetNetworkId,
        status: 'ACCEPTED',
        calculation: {
          estimatedNativeFeeAtomic: snapshot.estimatedNativeFeeAtomic,
          percentageBufferAtomic: snapshot.percentageBufferAtomic,
          fixedBufferAtomic: snapshot.fixedBufferAtomic,
          bufferedNativeFeeAtomic: snapshot.bufferedNativeFeeAtomic,
          chargedNetworkFeeAtomic: snapshot.chargedNetworkFeeAtomic,
          deviationBps: snapshot.deviationBps,
          roundingMode: snapshot.roundingMode,
        },
        calculatedAt: snapshot.calculatedAt,
        expiresAt: snapshot.expiresAt,
      },
    };
  }

  async insertQuote(
    input: Omit<StoredWithdrawalFeeQuote, 'id'>,
  ): Promise<StoredWithdrawalFeeQuote> {
    const quote = await this.prisma.withdrawalFeeQuote.create({
      data: {
        assetNetworkId: input.assetNetworkId,
        transferType: input.transferType,
        feeSnapshotId: input.feeSnapshotId,
        customerReference: input.customerReference,
        destinationAddress: input.destinationAddress,
        principalAtomic: input.principalAtomic,
        estimatedNativeFeeAtomic: input.estimatedNativeFeeAtomic,
        bufferedNativeFeeAtomic: input.bufferedNativeFeeAtomic,
        networkFeeAtomic: input.networkFeeAtomic,
        fixedServiceFeeAtomic: input.fixedServiceFeeAtomic,
        percentageServiceFeeAtomic: input.percentageServiceFeeAtomic,
        serviceFeeAtomic: input.serviceFeeAtomic,
        totalDebitAtomic: input.totalDebitAtomic,
        recipientAmountAtomic: input.recipientAmountAtomic,
        assetDecimals: input.assetDecimals,
        nativeFeeAssetDecimals: input.nativeFeeAssetDecimals,
        roundingMode: input.roundingMode,
        expiresAt: input.expiresAt,
        createdAt: input.createdAt,
      },
    });
    return { ...input, id: quote.id };
  }
}
