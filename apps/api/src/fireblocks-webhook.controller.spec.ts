import { HttpException } from '@nestjs/common';
import { CustodyWebhookError, CustodyWebhookIngestionService } from '../../../packages/domain/src';
import { FireblocksWebhookController } from './fireblocks-webhook.controller';

describe('FireblocksWebhookController', () => {
  const ingest = jest.fn();
  const controller = new FireblocksWebhookController({
    ingest,
  } as unknown as CustodyWebhookIngestionService);
  const rawBody = Buffer.from('{}');

  beforeEach(() => jest.clearAllMocks());

  it('acknowledges a newly persisted verified event', async () => {
    ingest.mockResolvedValue({ kind: 'STORED', inboxId: 'inbox-1' });
    await expect(
      controller.receive({ rawBody }, 'header..signature', 'application/json'),
    ).resolves.toEqual({ success: true, data: { accepted: true, duplicate: false } });
  });

  it('acknowledges a duplicate without reapplying it', async () => {
    ingest.mockResolvedValue({ kind: 'DUPLICATE', inboxId: 'inbox-1' });
    await expect(
      controller.receive({ rawBody }, 'header..signature', 'application/json'),
    ).resolves.toEqual({ success: true, data: { accepted: true, duplicate: true } });
  });

  it('rejects a missing provider signature before ingestion', async () => {
    await expect(
      controller.receive({ rawBody }, undefined, 'application/json'),
    ).rejects.toMatchObject({
      response: { error: { code: 'FIREBLOCKS_WEBHOOK_SIGNATURE_REQUIRED' } },
    });
    expect(ingest).not.toHaveBeenCalled();
  });

  it.each([
    ['FIREBLOCKS_WEBHOOK_SIGNATURE_INVALID', 401],
    ['FIREBLOCKS_WEBHOOK_SIGNING_KEY_UNKNOWN', 401],
    ['FIREBLOCKS_JWKS_UNAVAILABLE', 503],
    ['FIREBLOCKS_WEBHOOK_PAYLOAD_INVALID', 400],
  ])('maps %s to status %s without echoing provider data', async (code, status) => {
    ingest.mockRejectedValue(new CustodyWebhookError(code));
    let caught: unknown;
    try {
      await controller.receive({ rawBody }, 'header..signature', 'application/json');
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(status);
    expect((caught as HttpException).getResponse()).toEqual({
      success: false,
      error: { code, message: 'The webhook could not be accepted' },
    });
  });
});
