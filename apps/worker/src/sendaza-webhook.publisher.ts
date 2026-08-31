import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { SendazaWebhookConfiguration } from '../../../packages/configuration/src';
import { ClaimedOutboxEvent, OutboxPublisher } from '../../../packages/domain/src';

export const SENDAZA_FETCH = Symbol('SENDAZA_FETCH');

export class OutboxPublishError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OutboxPublishError';
  }
}

@Injectable()
export class SendazaWebhookPublisher implements OutboxPublisher {
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly configuration: SendazaWebhookConfiguration,
    @Optional() @Inject(SENDAZA_FETCH) fetcher?: typeof fetch,
  ) {
    this.fetcher = fetcher ?? globalThis.fetch;
  }

  async publish(event: ClaimedOutboxEvent): Promise<void> {
    const timestamp = new Date().toISOString();
    const rawBody = JSON.stringify({
      eventId: event.id,
      type: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
      data: event.payload,
    });
    const signature = createHmac('sha256', this.configuration.secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('base64url');

    let response: Response;
    try {
      response = await this.fetcher(this.configuration.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sle-event-id': event.id,
          'x-sle-timestamp': timestamp,
          'x-sle-signature': signature,
          'x-correlation-id': event.correlationId,
        },
        body: rawBody,
        signal: AbortSignal.timeout(this.configuration.timeoutMs),
      });
    } catch (error: unknown) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError'
          ? 'SENDAZA_WEBHOOK_TIMEOUT'
          : 'SENDAZA_WEBHOOK_UNAVAILABLE';
      throw new OutboxPublishError(code);
    }

    if (response.ok) return;
    if (response.status === 429) throw new OutboxPublishError('SENDAZA_WEBHOOK_RATE_LIMITED');
    if (response.status >= 500) throw new OutboxPublishError('SENDAZA_WEBHOOK_SERVER_ERROR');
    throw new OutboxPublishError('SENDAZA_WEBHOOK_REJECTED');
  }
}
