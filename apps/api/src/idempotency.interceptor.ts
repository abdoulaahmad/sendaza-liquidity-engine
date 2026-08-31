import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, from, map, mergeMap, of, throwError } from 'rxjs';
import {
  AuthenticatedRequestContext,
  IdempotencyRepository,
  JsonValue,
  createIdempotencyIdentity,
  validateIdempotencyKey,
} from '../../../packages/domain/src';
import { IDEMPOTENT_OPERATION } from './idempotent-operation.decorator';

type MutationRequest = {
  readonly method: string;
  readonly originalUrl: string;
  readonly rawBody?: Buffer;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly authentication?: AuthenticatedRequestContext;
  readonly correlationId?: string;
};

type ApiResponse = {
  statusCode: number;
  status(code: number): ApiResponse;
};

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyRepository,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<MutationRequest>();
    if (!MUTATION_METHODS.has(request.method.toUpperCase())) return next.handle();

    const operation = this.reflector.get<string>(IDEMPOTENT_OPERATION, context.getHandler());
    if (!operation) {
      throw this.failure(500, 'IDEMPOTENCY_OPERATION_NOT_CONFIGURED', 'Mutation is unavailable');
    }
    const key = this.header(request, 'idempotency-key');
    if (!key) {
      throw this.failure(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An idempotency key is required');
    }
    if (!validateIdempotencyKey(key)) {
      throw this.failure(400, 'INVALID_IDEMPOTENCY_KEY', 'The idempotency key is invalid');
    }
    if (!request.authentication || !request.correlationId) {
      throw this.failure(401, 'AUTHENTICATION_REQUIRED', 'Request authentication is required');
    }

    const identity = createIdempotencyIdentity({
      clientId: request.authentication.clientId,
      operation,
      key,
      method: request.method,
      rawTarget: request.originalUrl,
      rawBody: request.rawBody ?? Buffer.alloc(0),
      correlationId: request.correlationId,
    });
    const decision = await this.idempotency.acquire(identity);
    if (decision.kind === 'CONFLICT') {
      throw this.failure(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'The idempotency key belongs to another request',
      );
    }
    if (decision.kind === 'IN_PROGRESS') {
      throw this.failure(
        409,
        'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        'The original request is still processing',
      );
    }

    const response = context.switchToHttp().getResponse<ApiResponse>();
    if (decision.kind === 'REPLAY') {
      response.status(decision.response.statusCode);
      return of(decision.response.body);
    }

    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(
          this.idempotency.complete(decision.recordId, identity.requestHash, {
            statusCode: response.statusCode,
            body: this.toJson(body),
          }),
        ).pipe(map(() => body)),
      ),
      catchError((error: unknown) => {
        if (!(error instanceof HttpException)) return throwError(() => error);
        const errorBody = this.toJson(error.getResponse());
        return from(
          this.idempotency.complete(decision.recordId, identity.requestHash, {
            statusCode: error.getStatus(),
            body: errorBody,
          }),
        ).pipe(mergeMap(() => throwError(() => error)));
      }),
    );
  }

  private header(request: MutationRequest, name: string): string | undefined {
    const value = request.headers[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private toJson(value: unknown): JsonValue {
    if (value === undefined) return null;
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return null;
    return JSON.parse(serialized) as JsonValue;
  }

  private failure(status: number, code: string, message: string): HttpException {
    return new HttpException({ success: false, error: { code, message } }, status);
  }
}
