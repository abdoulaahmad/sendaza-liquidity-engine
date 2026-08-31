import { CallHandler, ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { IdempotencyRepository } from '../../../packages/domain/src';
import { IDEMPOTENT_OPERATION } from './idempotent-operation.decorator';
import { IdempotencyInterceptor } from './idempotency.interceptor';

describe('IdempotencyInterceptor', () => {
  const acquire = jest.fn();
  const complete = jest.fn();
  const repository: IdempotencyRepository = { acquire, complete };
  const handler = () => undefined;
  const reflector = {
    get: jest.fn((key: string) => (key === IDEMPOTENT_OPERATION ? 'purchases.create' : undefined)),
  } as unknown as Reflector;
  const interceptor = new IdempotencyInterceptor(reflector, repository);

  function context(overrides: Record<string, unknown> = {}): ExecutionContext {
    const request = {
      method: 'POST',
      originalUrl: '/api/v1/purchases',
      rawBody: Buffer.from('{quoteId:quote-1}'),
      headers: { 'idempotency-key': 'purchase-1' },
      authentication: { clientId: 'sendaza-core' },
      correlationId: '00000000-0000-4000-8000-000000000001',
      ...overrides,
    };
    const response = {
      statusCode: 201,
      status: jest.fn(function (this: { statusCode: number }, code: number) {
        this.statusCode = code;
        return this;
      }),
    };
    return {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
      getHandler: () => handler,
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    (reflector.get as jest.Mock).mockReturnValue('purchases.create');
    complete.mockResolvedValue(undefined);
  });

  it('acquires and stores a successful response', async () => {
    acquire.mockResolvedValue({ kind: 'ACQUIRED', recordId: 'record-1' });
    const stream = await interceptor.intercept(context(), {
      handle: () => of({ success: true }),
    } as CallHandler);
    await expect(firstValueFrom(stream)).resolves.toEqual({ success: true });
    expect(complete).toHaveBeenCalledWith('record-1', expect.stringMatching(/^[a-f0-9]{64}$/), {
      statusCode: 201,
      body: { success: true },
    });
  });

  it('returns the stored response without invoking the handler', async () => {
    acquire.mockResolvedValue({
      kind: 'REPLAY',
      response: { statusCode: 202, body: { state: 'accepted' } },
    });
    const next = { handle: jest.fn(() => of({ shouldNotRun: true })) };
    const executionContext = context();
    const stream = await interceptor.intercept(executionContext, next);
    await expect(firstValueFrom(stream)).resolves.toEqual({ state: 'accepted' });
    expect(next.handle).not.toHaveBeenCalled();
    expect(executionContext.switchToHttp().getResponse().status).toHaveBeenCalledWith(202);
  });

  it.each([
    [{ kind: 'CONFLICT' }, 'IDEMPOTENCY_KEY_REUSED'],
    [{ kind: 'IN_PROGRESS' }, 'IDEMPOTENCY_REQUEST_IN_PROGRESS'],
  ])('maps %s to a stable conflict', async (decision, code) => {
    acquire.mockResolvedValue(decision);
    await expect(
      interceptor.intercept(context(), { handle: () => of(null) }),
    ).rejects.toMatchObject({ response: { error: { code } } });
  });

  it('requires a key for every mutation', async () => {
    await expect(
      interceptor.intercept(context({ headers: {} }), { handle: () => of(null) }),
    ).rejects.toMatchObject({ response: { error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } } });
    expect(acquire).not.toHaveBeenCalled();
  });

  it('fails closed when a mutation has no declared stable operation', async () => {
    (reflector.get as jest.Mock).mockReturnValue(undefined);
    await expect(
      interceptor.intercept(context(), { handle: () => of(null) }),
    ).rejects.toMatchObject({
      response: { error: { code: 'IDEMPOTENCY_OPERATION_NOT_CONFIGURED' } },
    });
    expect(acquire).not.toHaveBeenCalled();
  });

  it('does not apply idempotency to read-only requests', async () => {
    const stream = await interceptor.intercept(context({ method: 'GET', headers: {} }), {
      handle: () => of({ success: true }),
    });
    await expect(firstValueFrom(stream)).resolves.toEqual({ success: true });
    expect(acquire).not.toHaveBeenCalled();
  });

  it('stores stable HTTP failures for deterministic replay', async () => {
    acquire.mockResolvedValue({ kind: 'ACQUIRED', recordId: 'record-1' });
    const expected = new HttpException({ success: false, error: { code: 'QUOTE_EXPIRED' } }, 409);
    const stream = await interceptor.intercept(context(), {
      handle: () => throwError(() => expected),
    } as CallHandler);
    await expect(firstValueFrom(stream)).rejects.toBe(expected);
    expect(complete).toHaveBeenCalledWith('record-1', expect.any(String), {
      statusCode: 409,
      body: { success: false, error: { code: 'QUOTE_EXPIRED' } },
    });
  });
});
