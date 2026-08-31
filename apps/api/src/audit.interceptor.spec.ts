import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AuditRepository } from '../../../packages/domain/src';
import { AUDIT_OPERATION } from './audit-operation.decorator';
import { AuditInterceptor } from './audit.interceptor';

describe('AuditInterceptor', () => {
  const record = jest.fn();
  const audit: AuditRepository = { record };
  const reflector = {
    get: jest.fn((key: string) => (key === AUDIT_OPERATION ? 'assets.list' : undefined)),
  } as unknown as Reflector;
  const interceptor = new AuditInterceptor(reflector, audit);
  const request = {
    method: 'GET',
    rawBody: Buffer.from('sensitive-body'),
    headers: { 'x-sle-signature': 'sensitive-signature' },
    authentication: { clientId: 'sendaza-core', credentialKeyId: 'sendaza-1' },
    correlationId: '00000000-0000-4000-8000-000000000001',
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 200 }) }),
    getHandler: () => context,
  } as unknown as ExecutionContext;

  beforeEach(() => {
    jest.resetAllMocks();
    (reflector.get as jest.Mock).mockImplementation((key: string) =>
      key === AUDIT_OPERATION ? 'assets.list' : undefined,
    );
    record.mockResolvedValue(undefined);
  });

  it('records a successful protected operation without request secrets', async () => {
    await expect(
      firstValueFrom(
        interceptor.intercept(context, { handle: () => of({ success: true }) } as CallHandler),
      ),
    ).resolves.toEqual({ success: true });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'sendaza-core',
        resourceId: 'assets.list',
        metadata: {
          method: 'GET',
          statusCode: 200,
          outcome: 'SUCCESS',
          credentialKeyId: 'sendaza-1',
        },
      }),
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain('sensitive');
  });

  it('records a stable failure before preserving the API error', async () => {
    const error = new HttpException('conflict', 409);
    await expect(
      firstValueFrom(
        interceptor.intercept(context, { handle: () => throwError(() => error) } as CallHandler),
      ),
    ).rejects.toBe(error);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api.request.failed',
        metadata: expect.objectContaining({ statusCode: 409, outcome: 'FAILURE' }),
      }),
    );
  });

  it('fails closed when protected operation metadata is absent', () => {
    (reflector.get as jest.Mock).mockReturnValue(undefined);
    expect(() => interceptor.intercept(context, { handle: () => of(null) })).toThrow(
      'AUDIT_OPERATION_NOT_CONFIGURED',
    );
  });
});
