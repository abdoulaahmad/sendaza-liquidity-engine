import { SetMetadata, applyDecorators } from '@nestjs/common';
import { PublicRoute } from './public-route.decorator';

export const PROVIDER_WEBHOOK_ROUTE = Symbol('PROVIDER_WEBHOOK_ROUTE');

export const ProviderWebhookRoute = (): MethodDecorator & ClassDecorator =>
  applyDecorators(PublicRoute(), SetMetadata(PROVIDER_WEBHOOK_ROUTE, true));
