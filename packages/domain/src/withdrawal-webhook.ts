import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface VerifiedCustodyWebhook {
  readonly providerEventId: string;
  readonly eventType: string;
  readonly providerTransferId?: string;
  readonly rawBody: Uint8Array;
  readonly signatureKeyId: string;
  readonly receivedAt: Date;
}

export type CustodyWebhookPersistResult =
  | { readonly kind: 'STORED'; readonly inboxId: string }
  | { readonly kind: 'DUPLICATE'; readonly inboxId: string };

export abstract class CustodyWebhookInboxRepository {
  abstract persistVerified(webhook: VerifiedCustodyWebhook): Promise<CustodyWebhookPersistResult>;
}

export interface CustodyWebhookSignatureVerifier {
  verify(rawBody: Uint8Array, detachedJws: string): Promise<{ readonly keyId: string }>;
}

export class CustodyWebhookError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CustodyWebhookError';
  }
}

@Injectable()
export class CustodyWebhookIngestionService {
  constructor(
    private readonly verifier: CustodyWebhookSignatureVerifier,
    private readonly inbox: CustodyWebhookInboxRepository,
    private readonly maximumBodyBytes: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async ingest(input: {
    readonly rawBody: Uint8Array;
    readonly signature: string;
    readonly contentType?: string;
  }): Promise<CustodyWebhookPersistResult> {
    if (input.contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new CustodyWebhookError('FIREBLOCKS_WEBHOOK_CONTENT_TYPE_INVALID');
    }
    if (input.rawBody.byteLength === 0 || input.rawBody.byteLength > this.maximumBodyBytes) {
      throw new CustodyWebhookError('FIREBLOCKS_WEBHOOK_BODY_SIZE_INVALID');
    }

    const verified = await this.verifier.verify(input.rawBody, input.signature);
    const payload = parsePayload(input.rawBody);
    return this.inbox.persistVerified({
      providerEventId: payload.id,
      eventType: payload.eventType,
      ...(payload.providerTransferId ? { providerTransferId: payload.providerTransferId } : {}),
      rawBody: input.rawBody,
      signatureKeyId: verified.keyId,
      receivedAt: this.clock(),
    });
  }
}

function parsePayload(rawBody: Uint8Array): {
  id: string;
  eventType: string;
  providerTransferId?: string;
} {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(rawBody).toString('utf8')) as unknown;
  } catch {
    throw new CustodyWebhookError('FIREBLOCKS_WEBHOOK_JSON_INVALID');
  }
  if (!isRecord(value) || !uuid(value.id) || !supportedEventType(value.eventType)) {
    throw new CustodyWebhookError('FIREBLOCKS_WEBHOOK_PAYLOAD_INVALID');
  }
  const data = isRecord(value.data) ? value.data : undefined;
  if (!data || !nonEmpty(data.id, 150)) {
    throw new CustodyWebhookError('FIREBLOCKS_WEBHOOK_PAYLOAD_INVALID');
  }
  return { id: value.id, eventType: value.eventType, providerTransferId: data.id };
}

export function custodyWebhookPayloadSha256(rawBody: Uint8Array): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

const SUPPORTED_EVENT_TYPES = new Set([
  'transaction.created',
  'transaction.status.updated',
  'transaction.network_records.processing_completed',
]);

function supportedEventType(value: unknown): value is string {
  return nonEmpty(value, 100) && SUPPORTED_EVENT_TYPES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function uuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
