import { Controller, Headers, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import { CustodyWebhookError, CustodyWebhookIngestionService } from '../../../packages/domain/src';
import { ProviderWebhookRoute } from './provider-webhook-route.decorator';

@Controller('webhooks/fireblocks')
@ProviderWebhookRoute()
export class FireblocksWebhookController {
  constructor(private readonly ingestion: CustodyWebhookIngestionService) {}

  @Post()
  @HttpCode(202)
  async receive(
    @Req() request: { readonly rawBody?: Buffer },
    @Headers('fireblocks-webhook-signature') signature: string | undefined,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<{ success: true; data: { accepted: true; duplicate: boolean } }> {
    if (!signature) throw failure(401, 'FIREBLOCKS_WEBHOOK_SIGNATURE_REQUIRED');
    if (!request.rawBody) throw failure(400, 'FIREBLOCKS_WEBHOOK_RAW_BODY_REQUIRED');
    try {
      const result = await this.ingestion.ingest({
        rawBody: request.rawBody,
        signature,
        contentType,
      });
      return { success: true, data: { accepted: true, duplicate: result.kind === 'DUPLICATE' } };
    } catch (error: unknown) {
      if (!(error instanceof CustodyWebhookError)) throw error;
      const unavailable = error.code === 'FIREBLOCKS_JWKS_UNAVAILABLE';
      const unauthorized =
        error.code === 'FIREBLOCKS_WEBHOOK_SIGNATURE_INVALID' ||
        error.code === 'FIREBLOCKS_WEBHOOK_SIGNING_KEY_UNKNOWN';
      throw failure(unavailable ? 503 : unauthorized ? 401 : 400, error.code);
    }
  }
}

function failure(status: number, code: string): HttpException {
  return new HttpException(
    { success: false, error: { code, message: 'The webhook could not be accepted' } },
    status,
  );
}
