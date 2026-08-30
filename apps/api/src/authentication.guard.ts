import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CredentialSecretProvider } from '../../../packages/configuration/src';
import {
  AuthenticatedRequestContext,
  AuthenticationError,
  AuthenticationNonceRepository,
  CredentialMetadataRepository,
  HmacAuthenticator,
} from '../../../packages/domain/src';
import { PUBLIC_ROUTE } from './public-route.decorator';

type ApiRequest = {
  readonly method: string;
  readonly originalUrl: string;
  readonly rawBody?: Buffer;
  readonly headers: Record<string, string | string[] | undefined>;
  authentication?: AuthenticatedRequestContext;
  correlationId?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthenticationGuard implements CanActivate {
  private readonly authenticator = new HmacAuthenticator();

  constructor(
    private readonly reflector: Reflector,
    private readonly secrets: CredentialSecretProvider,
    private readonly credentials: CredentialMetadataRepository,
    private readonly nonces: AuthenticationNonceRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;

    const request = context.switchToHttp().getRequest<ApiRequest>();
    const correlationId = this.header(request, 'x-correlation-id');
    if (!correlationId || !UUID_PATTERN.test(correlationId)) {
      throw this.failure(400, 'INVALID_CORRELATION_ID', 'A valid correlation ID is required');
    }
    request.correlationId = correlationId;

    const keyId = this.requiredAuthenticationHeader(request, 'x-sle-key-id');
    const timestamp = this.requiredAuthenticationHeader(request, 'x-sle-timestamp');
    const nonce = this.requiredAuthenticationHeader(request, 'x-sle-nonce');
    const signature = this.requiredAuthenticationHeader(request, 'x-sle-signature');
    const secret = this.secrets.get(keyId);
    const metadata = secret ? await this.credentials.findByKeyId(keyId) : undefined;

    try {
      const authenticated = this.authenticator.authenticate(
        {
          method: request.method,
          rawTarget: request.originalUrl,
          timestamp,
          nonce,
          signature,
          rawBody: request.rawBody ?? Buffer.alloc(0),
        },
        metadata && secret ? { ...metadata, secret } : undefined,
      );
      if (!(await this.nonces.claim(authenticated))) {
        throw this.failure(
          409,
          'REQUEST_REPLAYED',
          'This signed request has already been processed',
        );
      }
      request.authentication = authenticated;
      return true;
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (error instanceof AuthenticationError) {
        throw this.failure(401, error.code, 'Request authentication failed');
      }
      throw error;
    }
  }

  private requiredAuthenticationHeader(request: ApiRequest, name: string): string {
    const value = this.header(request, name);
    if (!value)
      throw this.failure(
        401,
        'AUTHENTICATION_REQUIRED',
        'Signed authentication headers are required',
      );
    return value;
  }

  private header(request: ApiRequest, name: string): string | undefined {
    const value = request.headers[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private failure(status: number, code: string, message: string): HttpException {
    return new HttpException({ success: false, error: { code, message } }, status);
  }
}
