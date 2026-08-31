import { createHmac } from 'node:crypto';
import { SendazaWebhookConfiguration } from '../../../packages/configuration/src';
import { ClaimedOutboxEvent } from '../../../packages/domain/src';
import { OutboxPublishError, SendazaWebhookPublisher } from './sendaza-webhook.publisher';

describe('SendazaWebhookPublisher', () => {
  const secret = 'sendaza-webhook-secret-at-least-32-bytes';
  const configuration = {
    url: 'https://sendaza.example/api/v1/integrations/sle/webhooks',
    secret,
    timeoutMs: 5000,
  } as SendazaWebhookConfiguration;
  const event: ClaimedOutboxEvent = {
    id: '00000000-0000-4000-8000-000000000001',
    aggregateType: 'purchase',
    aggregateId: 'purchase-1',
    eventType: 'sle.purchase.completed',
    payload: { purchaseId: 'purchase-1', amount: '1.000000' },
    correlationId: '00000000-0000-4000-8000-000000000002',
    occurredAt: new Date('2026-08-31T12:00:00.000Z'),
    attemptCount: 1,
    maxAttempts: 10,
    leaseToken: '00000000-0000-4000-8000-000000000003',
    leaseExpiresAt: new Date('2026-08-31T12:00:30.000Z'),
  };

  it('signs and sends the exact stable event body', async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    const publisher = new SendazaWebhookPublisher(configuration, fetcher);
    await publisher.publish(event);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const expectedBody = JSON.stringify({
      eventId: event.id,
      type: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
      data: event.payload,
    });
    expect(url).toBe(configuration.url);
    expect(init.body).toBe(expectedBody);
    expect(headers['x-sle-signature']).toBe(
      createHmac('sha256', secret)
        .update(`${headers['x-sle-timestamp']}.${expectedBody}`)
        .digest('base64url'),
    );
    expect(headers['x-sle-event-id']).toBe(event.id);
  });

  it.each([
    [429, 'SENDAZA_WEBHOOK_RATE_LIMITED'],
    [503, 'SENDAZA_WEBHOOK_SERVER_ERROR'],
    [400, 'SENDAZA_WEBHOOK_REJECTED'],
  ])('maps HTTP %s to safe code %s', async (status, code) => {
    const publisher = new SendazaWebhookPublisher(
      configuration,
      jest.fn().mockResolvedValue({ ok: false, status }),
    );
    await expect(publisher.publish(event)).rejects.toEqual(new OutboxPublishError(code));
  });

  it('does not expose transport error details', async () => {
    const publisher = new SendazaWebhookPublisher(
      configuration,
      jest.fn().mockRejectedValue(new Error('secret network detail')),
    );
    await expect(publisher.publish(event)).rejects.toEqual(
      new OutboxPublishError('SENDAZA_WEBHOOK_UNAVAILABLE'),
    );
  });
});
