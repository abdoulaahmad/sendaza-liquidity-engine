import { Body, Controller, Get, HttpException, Param, Post, Req } from '@nestjs/common';
import {
  ContractValidationError,
  parseCreateWithdrawalBody,
} from '../../../packages/contracts/src';
import { WithdrawalError, WithdrawalService, WithdrawalView } from '../../../packages/domain/src';
import { AuditOperation } from './audit-operation.decorator';
import { IdempotentOperation } from './idempotent-operation.decorator';

type RequestContext = { correlationId?: string };

@Controller('withdrawals')
export class WithdrawalController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @Post()
  @AuditOperation('withdrawals.create')
  @IdempotentOperation('withdrawals.create')
  async create(
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<{ success: true; data: WithdrawalView }> {
    try {
      const value = parseCreateWithdrawalBody(body);
      return {
        success: true,
        data: await this.withdrawals.create({ ...value, correlationId: correlation(request) }),
      };
    } catch (error: unknown) {
      throw mapped(error);
    }
  }

  @Post(':id/cancel')
  @AuditOperation('withdrawals.cancel')
  @IdempotentOperation('withdrawals.cancel')
  async cancel(
    @Param('id') id: string,
    @Req() request: RequestContext,
  ): Promise<{ success: true; data: WithdrawalView }> {
    try {
      if (!uuid(id)) throw new ContractValidationError('INVALID_REQUEST_BODY');
      return {
        success: true,
        data: await this.withdrawals.cancel({
          withdrawalId: id,
          correlationId: correlation(request),
        }),
      };
    } catch (error: unknown) {
      throw mapped(error);
    }
  }

  @Get(':id')
  @AuditOperation('withdrawals.get')
  async get(@Param('id') id: string): Promise<{ success: true; data: WithdrawalView }> {
    try {
      if (!uuid(id)) throw new ContractValidationError('INVALID_REQUEST_BODY');
      return { success: true, data: await this.withdrawals.get(id) };
    } catch (error: unknown) {
      throw mapped(error);
    }
  }
}

function correlation(request: RequestContext): string {
  if (!request.correlationId) {
    throw new HttpException(
      {
        success: false,
        error: { code: 'CORRELATION_ID_REQUIRED', message: 'Correlation ID is required' },
      },
      400,
    );
  }
  return request.correlationId;
}
function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function mapped(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof ContractValidationError) {
    return new HttpException(
      { success: false, error: { code: error.code, message: 'The request body is invalid' } },
      400,
    );
  }
  if (error instanceof WithdrawalError) {
    const notFound = new Set(['WITHDRAWAL_NOT_FOUND', 'FEE_QUOTE_NOT_FOUND']);
    const unavailable = new Set(['WITHDRAWAL_POLICY_UNAVAILABLE']);
    const status = notFound.has(error.code) ? 404 : unavailable.has(error.code) ? 503 : 409;
    return new HttpException(
      {
        success: false,
        error: { code: error.code, message: 'The withdrawal command could not be completed' },
      },
      status,
    );
  }
  throw error;
}
