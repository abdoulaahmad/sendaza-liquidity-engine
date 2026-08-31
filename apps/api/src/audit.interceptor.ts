import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, from, map, mergeMap, throwError } from 'rxjs';
import { AuditRepository, AuthenticatedRequestContext } from '../../../packages/domain/src';
import { AUDIT_OPERATION } from './audit-operation.decorator';
import { IDEMPOTENT_OPERATION } from './idempotent-operation.decorator';

type AuditedRequest = {
  readonly method: string;
  readonly authentication?: AuthenticatedRequestContext;
  readonly correlationId?: string;
};

type ApiResponse = { readonly statusCode: number };

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditRepository,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditedRequest>();
    if (!request.authentication || !request.correlationId) return next.handle();

    const operation =
      this.reflector.get<string>(AUDIT_OPERATION, context.getHandler()) ??
      this.reflector.get<string>(IDEMPOTENT_OPERATION, context.getHandler());
    if (!operation) throw new Error('AUDIT_OPERATION_NOT_CONFIGURED');

    const response = context.switchToHttp().getResponse<ApiResponse>();
    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(this.record(request, operation, response.statusCode, 'SUCCESS')).pipe(map(() => body)),
      ),
      catchError((error: unknown) => {
        const statusCode = error instanceof HttpException ? error.getStatus() : 500;
        return from(this.record(request, operation, statusCode, 'FAILURE')).pipe(
          mergeMap(() => throwError(() => error)),
        );
      }),
    );
  }

  private record(
    request: AuditedRequest,
    operation: string,
    statusCode: number,
    outcome: 'SUCCESS' | 'FAILURE',
  ): Promise<void> {
    const authentication = request.authentication;
    if (!authentication || !request.correlationId) throw new Error('AUDIT_CONTEXT_MISSING');
    return this.audit.record({
      actorType: 'SERVICE_CLIENT',
      actorId: authentication.clientId,
      correlationId: request.correlationId,
      action: outcome === 'SUCCESS' ? 'api.request.completed' : 'api.request.failed',
      resourceType: 'api_operation',
      resourceId: operation,
      metadata: {
        method: request.method.toUpperCase(),
        statusCode,
        outcome,
        credentialKeyId: authentication.credentialKeyId,
      },
    });
  }
}
