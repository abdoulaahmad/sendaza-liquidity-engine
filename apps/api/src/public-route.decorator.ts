import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ROUTE = 'sle:public-route';
export const PublicRoute = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);
