import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { WithdrawalStatus } from './withdrawal';

export type WithdrawalEvidenceSource = 'FIREBLOCKS_WEBHOOK' | 'FIREBLOCKS_POLL' | 'CHAIN_RPC';

export interface WithdrawalFinalityEvidence {
  readonly source: WithdrawalEvidenceSource;
  readonly providerEventId?: string;
  readonly providerStatus?: string;
  readonly txHash?: string;
  readonly blockHash?: string;
  readonly blockNumber?: bigint;
  readonly confirmationCount?: number;
  readonly executionSucceeded?: boolean;
  readonly observedAt: Date;
}

export interface CustodyWebhookClaim {
  readonly inboxId: string;
  readonly providerEventId: string;
  readonly rawBody: Uint8Array;
  readonly leaseToken: string;
}

export interface WithdrawalFinalityClaim {
  readonly jobId: string;
  readonly withdrawalId: string;
  readonly providerTransferId: string;
  readonly leaseToken: string;
}

export interface WithdrawalFinalityApplication {
  readonly withdrawalId: string;
  readonly previousStatus: WithdrawalStatus;
  readonly status: WithdrawalStatus;
  readonly duplicateEvidence: boolean;
}

export abstract class WithdrawalFinalityRepository {
  abstract claimWebhookBatch(input: {
    readonly limit: number;
    readonly leaseSeconds: number;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<readonly CustodyWebhookClaim[]>;
  abstract applyWebhookEvidence(
    claim: CustodyWebhookClaim,
    evidence: WithdrawalFinalityEvidence,
    correlationId: string,
    now: Date,
  ): Promise<WithdrawalFinalityApplication | null>;
  abstract retryWebhook(claim: CustodyWebhookClaim, errorCode: string, now: Date): Promise<void>;
  abstract claimPollingBatch(input: {
    readonly limit: number;
    readonly leaseSeconds: number;
    readonly leaseToken: string;
    readonly now: Date;
  }): Promise<readonly WithdrawalFinalityClaim[]>;
  abstract applyPollingEvidence(
    claim: WithdrawalFinalityClaim,
    evidence: WithdrawalFinalityEvidence,
    correlationId: string,
    now: Date,
    nextPollAt: Date,
  ): Promise<WithdrawalFinalityApplication>;
  abstract retryPolling(
    claim: WithdrawalFinalityClaim,
    errorCode: string,
    nextPollAt: Date,
    now: Date,
  ): Promise<void>;
}

export abstract class CustodyWebhookEventNormalizer {
  abstract normalize(claim: CustodyWebhookClaim): WithdrawalFinalityEvidence;
}

export abstract class CustodyFinalityProvider {
  abstract getTransfer(providerTransferId: string): Promise<WithdrawalFinalityEvidence | null>;
}

@Injectable()
export class WithdrawalWebhookFinalityBatchService {
  constructor(
    private readonly repository: WithdrawalFinalityRepository,
    private readonly normalizer: CustodyWebhookEventNormalizer,
    private readonly batchSize: number,
    private readonly leaseSeconds: number,
  ) {}

  async processBatch(
    now: Date,
    leaseToken: string = randomUUID(),
  ): Promise<{
    claimed: number;
    processed: number;
    retried: number;
  }> {
    const claims = await this.repository.claimWebhookBatch({
      limit: this.batchSize,
      leaseSeconds: this.leaseSeconds,
      leaseToken,
      now,
    });
    let processed = 0;
    let retried = 0;
    for (const claim of claims) {
      try {
        const evidence = this.normalizer.normalize(claim);
        const result = await this.repository.applyWebhookEvidence(
          claim,
          evidence,
          randomUUID(),
          now,
        );
        if (result) processed += 1;
        else retried += 1;
      } catch (error: unknown) {
        await this.repository.retryWebhook(claim, finalityErrorCode(error), now);
        retried += 1;
      }
    }
    return { claimed: claims.length, processed, retried };
  }
}

@Injectable()
export class WithdrawalPollingFinalityBatchService {
  constructor(
    private readonly repository: WithdrawalFinalityRepository,
    private readonly provider: CustodyFinalityProvider,
    private readonly batchSize: number,
    private readonly leaseSeconds: number,
    private readonly pollIntervalSeconds: number,
  ) {}

  async processBatch(
    now: Date,
    leaseToken: string = randomUUID(),
  ): Promise<{
    claimed: number;
    observed: number;
    retried: number;
  }> {
    const claims = await this.repository.claimPollingBatch({
      limit: this.batchSize,
      leaseSeconds: this.leaseSeconds,
      leaseToken,
      now,
    });
    let observed = 0;
    let retried = 0;
    const nextPollAt = new Date(now.getTime() + this.pollIntervalSeconds * 1000);
    for (const claim of claims) {
      try {
        const evidence = await this.provider.getTransfer(claim.providerTransferId);
        if (!evidence) {
          await this.repository.retryPolling(
            claim,
            'FIREBLOCKS_TRANSFER_NOT_FOUND',
            nextPollAt,
            now,
          );
          retried += 1;
          continue;
        }
        await this.repository.applyPollingEvidence(claim, evidence, randomUUID(), now, nextPollAt);
        observed += 1;
      } catch (error: unknown) {
        await this.repository.retryPolling(claim, finalityErrorCode(error), nextPollAt, now);
        retried += 1;
      }
    }
    return { claimed: claims.length, observed, retried };
  }
}

export function withdrawalFinalityEvidenceHash(evidence: WithdrawalFinalityEvidence): string {
  const canonical = JSON.stringify({
    source: evidence.source,
    providerEventId: evidence.providerEventId ?? null,
    providerStatus: evidence.providerStatus ?? null,
    txHash: evidence.txHash ?? null,
    blockHash: evidence.blockHash ?? null,
    blockNumber: evidence.blockNumber?.toString() ?? null,
    confirmationCount: evidence.confirmationCount ?? null,
    executionSucceeded: evidence.executionSucceeded ?? null,
    observedAt: evidence.observedAt.toISOString(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function finalityErrorCode(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : 'WITHDRAWAL_FINALITY_UNKNOWN_ERROR';
  return /^[A-Z0-9_:-]{1,100}$/.test(code) ? code : 'WITHDRAWAL_FINALITY_UNKNOWN_ERROR';
}
