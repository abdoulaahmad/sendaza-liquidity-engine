import {
  CustodyWebhookClaim,
  CustodyWebhookEventNormalizer,
  WithdrawalFinalityEvidence,
} from '../../../packages/domain/src';

export class FireblocksWebhookEventNormalizer implements CustodyWebhookEventNormalizer {
  normalize(claim: CustodyWebhookClaim): WithdrawalFinalityEvidence {
    let value: unknown;
    try {
      value = JSON.parse(Buffer.from(claim.rawBody).toString('utf8')) as unknown;
    } catch {
      throw new FireblocksFinalityPayloadError();
    }
    if (!record(value) || !record(value.data)) throw new FireblocksFinalityPayloadError();
    const data = value.data;
    const status = text(data.status, 100);
    if (!status) throw new FireblocksFinalityPayloadError();

    const txHash =
      text(data.txHash, 255) ??
      (record(data.blockInfo) ? text(data.blockInfo.txHash, 255) : undefined);
    const blockInfo = record(data.blockInfo) ? data.blockInfo : undefined;
    const blockNumber = unsignedBigint(blockInfo?.blockHeight ?? blockInfo?.blockNumber);
    const confirmationCount = unsignedInteger(
      data.numOfConfirmations ?? data.confirmations,
      1_000_000,
    );
    const blockHash = text(blockInfo?.blockHash, 255);

    return {
      source: 'FIREBLOCKS_WEBHOOK',
      providerEventId: claim.providerEventId,
      providerStatus: status,
      ...(txHash ? { txHash } : {}),
      ...(blockHash ? { blockHash } : {}),
      ...(blockNumber === undefined ? {} : { blockNumber }),
      ...(confirmationCount === undefined ? {} : { confirmationCount }),
      observedAt: eventTime(value) ?? new Date(),
    };
  }
}

export class FireblocksFinalityPayloadError extends Error {
  readonly code = 'FIREBLOCKS_FINALITY_PAYLOAD_INVALID';

  constructor() {
    super('FIREBLOCKS_FINALITY_PAYLOAD_INVALID');
    this.name = 'FireblocksFinalityPayloadError';
  }
}

function eventTime(value: Record<string, unknown>): Date | undefined {
  const raw = value.createdAt ?? value.timestamp;
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function text(value: unknown, maximum: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    ? value
    : undefined;
}

function unsignedBigint(value: unknown): bigint | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  return undefined;
}

function unsignedInteger(value: unknown, maximum: number): number | undefined {
  const parsed =
    typeof value === 'number' && Number.isInteger(value)
      ? value
      : typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
        ? Number(value)
        : undefined;
  return parsed !== undefined && Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum
    ? parsed
    : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
