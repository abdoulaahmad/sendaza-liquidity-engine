import { Injectable } from '@nestjs/common';
import {
  NewTreasurySnapshot,
  TreasuryRepository,
  TreasurySyncClaim,
  TreasurySyncJobRepository,
  TreasurySyncTarget,
} from '../../domain/src';
import { Prisma } from './generated/prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaTreasuryRepository implements TreasuryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listSyncTargets(): Promise<readonly TreasurySyncTarget[]> {
    const wallets = await this.prisma.treasuryWallet.findMany({
      where: {
        status: 'ENABLED',
        custodyProvider: { status: 'ENABLED' },
        assetNetwork: {
          status: 'ENABLED',
          asset: { status: 'ENABLED' },
          network: { status: 'ENABLED' },
        },
      },
      include: {
        custodyProvider: { select: { code: true, type: true } },
        assetNetwork: {
          select: {
            networkDecimals: true,
            contractAddress: true,
            network: { select: { code: true, addressFamily: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return wallets.map((wallet) => ({
      walletId: wallet.id,
      assetNetworkId: wallet.assetNetworkId,
      networkCode: wallet.assetNetwork.network.code,
      addressFamily: wallet.assetNetwork.network.addressFamily,
      assetDecimals: wallet.assetNetwork.networkDecimals,
      ...(wallet.assetNetwork.contractAddress
        ? { contractAddress: wallet.assetNetwork.contractAddress }
        : {}),
      providerKind: wallet.custodyProvider.type,
      providerCode: wallet.custodyProvider.code,
      providerVaultId: wallet.providerVaultId,
      providerAssetId: wallet.providerAssetId,
      publicAddress: wallet.publicAddress,
      ...(wallet.addressTag ? { addressTag: wallet.addressTag } : {}),
      verificationRequired: wallet.verificationRequired,
      safetyBufferAtomic: wallet.safetyBufferAtomic,
      gasReserveAtomic: wallet.gasReserveAtomic,
      staleAfterSeconds: wallet.staleAfterSeconds,
    }));
  }

  async saveSnapshot(snapshot: NewTreasurySnapshot): Promise<string> {
    return this.prisma.$transaction(async (transaction) => {
      const created = await transaction.treasurySnapshot.create({
        data: {
          treasuryWalletId: snapshot.walletId,
          assetNetworkId: snapshot.assetNetworkId,
          controlledAtomic: snapshot.controlledAtomic,
          providerAvailableAtomic: snapshot.providerAvailableAtomic,
          pendingAtomic: snapshot.pendingAtomic,
          frozenAtomic: snapshot.frozenAtomic,
          lockedAtomic: snapshot.lockedAtomic,
          chainConfirmedAtomic: snapshot.chainConfirmedAtomic,
          reservedAtomic: snapshot.reservedAtomic,
          safetyBufferAtomic: snapshot.safetyBufferAtomic,
          gasReserveAtomic: snapshot.gasReserveAtomic,
          unavailableAtomic: snapshot.unavailableAtomic,
          sellableAtomic: snapshot.sellableAtomic,
          verificationStatus: snapshot.verificationStatus,
          providerReference: snapshot.providerReference,
          observedAt: snapshot.observedAt,
          expiresAt: snapshot.expiresAt,
        },
        select: { id: true },
      });
      const state = {
        latestSnapshotId: created.id,
        sellableAtomic: snapshot.sellableAtomic,
        reservedAtomic: snapshot.reservedAtomic,
        verificationStatus: snapshot.verificationStatus,
        evidenceExpiresAt: snapshot.expiresAt,
      };
      await transaction.treasuryInventoryState.upsert({
        where: { assetNetworkId: snapshot.assetNetworkId },
        create: { assetNetworkId: snapshot.assetNetworkId, ...state },
        update: state,
      });
      return created.id;
    });
  }
}

type ClaimedRow = { id: string; walletid: string; leasetoken: string };

@Injectable()
export class PrismaTreasurySyncJobRepository implements TreasurySyncJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claimBatch(input: {
    readonly limit: number;
    readonly leaseSeconds: number;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<readonly TreasurySyncClaim[]> {
    validateClaim(input.limit, input.leaseSeconds);
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1000);
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT id FROM treasury_sync_jobs
        WHERE (status = 'PENDING' AND next_sync_at <= ${input.now})
           OR (status = 'LEASED' AND lease_expires_at <= ${input.now})
        ORDER BY next_sync_at, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${input.limit}
      )
      UPDATE treasury_sync_jobs AS job
      SET status = 'LEASED', lease_token = ${input.leaseToken}::uuid,
          lease_expires_at = ${leaseExpiresAt}, attempt_count = attempt_count + 1,
          updated_at = ${input.now}
      FROM candidates WHERE job.id = candidates.id
      RETURNING job.id, job.treasury_wallet_id AS walletId, job.lease_token AS leaseToken
    `);
    return rows.map((row) => ({
      jobId: row.id,
      walletId: row.walletid,
      leaseToken: row.leasetoken,
    }));
  }

  async complete(jobId: string, leaseToken: string, nextSyncAt: Date): Promise<void> {
    await this.release(jobId, leaseToken, nextSyncAt, null);
  }

  async fail(
    jobId: string,
    leaseToken: string,
    nextSyncAt: Date,
    errorCode: string,
  ): Promise<void> {
    await this.release(jobId, leaseToken, nextSyncAt, errorCode.slice(0, 100));
  }

  private async release(
    jobId: string,
    leaseToken: string,
    nextSyncAt: Date,
    lastErrorCode: string | null,
  ): Promise<void> {
    const result = await this.prisma.treasurySyncJob.updateMany({
      where: { id: jobId, status: 'LEASED', leaseToken },
      data: {
        status: 'PENDING',
        leaseToken: null,
        leaseExpiresAt: null,
        nextSyncAt,
        lastErrorCode,
      },
    });
    if (result.count !== 1) throw new Error('TREASURY_SYNC_LEASE_LOST');
  }
}

function validateClaim(limit: number, leaseSeconds: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('INVALID_TREASURY_SYNC_BATCH_LIMIT');
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) {
    throw new Error('INVALID_TREASURY_SYNC_LEASE_SECONDS');
  }
}
