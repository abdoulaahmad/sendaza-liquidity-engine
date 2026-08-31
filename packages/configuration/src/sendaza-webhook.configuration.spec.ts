import { SendazaWebhookConfiguration } from './sendaza-webhook.configuration';

describe('SendazaWebhookConfiguration', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.SLE_SENDAZA_WEBHOOK_URL = 'http://127.0.0.1:4000/api/v1/integrations/sle/webhooks';
    process.env.SLE_SENDAZA_WEBHOOK_SECRET = 'a-secret-containing-at-least-32-bytes';
    process.env.SLE_SENDAZA_WEBHOOK_TIMEOUT_MS = '2500';
    process.env.SLE_OUTBOX_POLL_INTERVAL_MS = '500';
  });

  afterAll(() => {
    process.env = original;
  });

  it('loads bounded worker and publisher settings', () => {
    expect(new SendazaWebhookConfiguration()).toMatchObject({
      url: 'http://127.0.0.1:4000/api/v1/integrations/sle/webhooks',
      timeoutMs: 2500,
      pollIntervalMs: 500,
    });
  });

  it('requires HTTPS outside local development', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new SendazaWebhookConfiguration()).toThrow('must use HTTPS');
  });

  it('rejects short secrets and unbounded timeouts', () => {
    process.env.SLE_SENDAZA_WEBHOOK_SECRET = 'short';
    expect(() => new SendazaWebhookConfiguration()).toThrow('at least 32 bytes');
    process.env.SLE_SENDAZA_WEBHOOK_SECRET = 'a-secret-containing-at-least-32-bytes';
    process.env.SLE_SENDAZA_WEBHOOK_TIMEOUT_MS = '90000';
    expect(() => new SendazaWebhookConfiguration()).toThrow('between 100 and 30000');
  });
});
