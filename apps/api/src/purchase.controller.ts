import { Body, Controller, Get, HttpException, Param, Post, Req } from '@nestjs/common';
import {
  parseCreatePurchaseBody,
  parseSettlePurchaseBody,
  ContractValidationError,
} from '../../../packages/contracts/src';
import { PurchaseError, PurchaseService, PurchaseView } from '../../../packages/domain/src';
import { AuditOperation } from './audit-operation.decorator';
import { IdempotentOperation } from './idempotent-operation.decorator';

type RequestContext = { correlationId?: string };

@Controller('purchases')
export class PurchaseController {
  constructor(private readonly purchases: PurchaseService) {}

  @Post()
  @AuditOperation('purchases.create')
  @IdempotentOperation('purchases.create')
  async create(
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<{ success: true; data: PurchaseView }> {
    try {
      const value = parseCreatePurchaseBody(body);
      return {
        success: true,
        data: await this.purchases.create({ ...value, correlationId: correlation(request) }),
      };
    } catch (error: unknown) {
      throw mapped(error);
    }
  }

  @Post(':id/settlement')
  @AuditOperation('purchases.settle')
  @IdempotentOperation('purchases.settle')
  async settle(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: RequestContext,
  ): Promise<{ success: true; data: PurchaseView }> {
    try {
      const value = parseSettlePurchaseBody(body);
      if (!uuid(id)) throw new ContractValidationError('INVALID_REQUEST_BODY');
      return {
        success: true,
        data: await this.purchases.settle({
          purchaseId: id,
          outcome: value.status,
          clientSettlementReference: value.clientSettlementReference,
          clientSettledAt: new Date(value.settledAt),
          correlationId: correlation(request),
        }),
      };
    } catch (error: unknown) {
      throw mapped(error);
    }
  }

  @Get(':id')
  @AuditOperation('purchases.get')
  async get(@Param('id') id: string): Promise<{ success: true; data: PurchaseView }> {
    try {
      if (!uuid(id)) throw new ContractValidationError('INVALID_REQUEST_BODY');
      return { success: true, data: await this.purchases.get(id) };
    } catch (error: unknown) {
      throw mapped(error);
    }
  }
}

function correlation(request: RequestContext): string {
  if (!request.correlationId)
    throw new HttpException(
      {
        success: false,
        error: { code: 'CORRELATION_ID_REQUIRED', message: 'Correlation ID is required' },
      },
      400,
    );
  return request.correlationId;
}
function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function mapped(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof ContractValidationError)
    return new HttpException(
      { success: false, error: { code: error.code, message: 'The request body is invalid' } },
      400,
    );
  if (error instanceof PurchaseError) {
    const unavailable = new Set([
      'INVENTORY_UNAVAILABLE',
      'INVENTORY_EVIDENCE_EXPIRED',
      'INVENTORY_EVIDENCE_UNSAFE',
    ]);
    const status =
      error.code === 'PURCHASE_NOT_FOUND' || error.code === 'QUOTE_NOT_FOUND'
        ? 404
        : unavailable.has(error.code)
          ? 503
          : 409;
    return new HttpException(
      {
        success: false,
        error: { code: error.code, message: 'The purchase command could not be completed' },
      },
      status,
    );
  }
  throw error;
}
