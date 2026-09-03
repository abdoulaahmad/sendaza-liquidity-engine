import { Body, Controller, HttpException, Post } from '@nestjs/common';
import {
  ContractValidationError,
  parseCreateWithdrawalFeeQuoteBody,
} from '../../../packages/contracts/src';
import {
  WithdrawalFeeQuoteError,
  WithdrawalFeeQuoteService,
  WithdrawalFeeQuoteView,
} from '../../../packages/domain/src';
import { AuditOperation } from './audit-operation.decorator';
import { IdempotentOperation } from './idempotent-operation.decorator';

@Controller('withdrawal-fee-quotes')
export class WithdrawalFeeQuoteController {
  constructor(private readonly quotes: WithdrawalFeeQuoteService) {}

  @Post()
  @AuditOperation('withdrawal-fee-quotes.create')
  @IdempotentOperation('withdrawal-fee-quotes.create')
  async create(@Body() body: unknown): Promise<{ success: true; data: WithdrawalFeeQuoteView }> {
    try {
      return {
        success: true,
        data: await this.quotes.create(parseCreateWithdrawalFeeQuoteBody(body)),
      };
    } catch (error: unknown) {
      if (error instanceof ContractValidationError) {
        throw new HttpException(
          { success: false, error: { code: error.code, message: 'The request body is invalid' } },
          400,
        );
      }
      if (error instanceof WithdrawalFeeQuoteError) {
        const unavailable = new Set([
          'NETWORK_FEE_ROUTE_UNAVAILABLE',
          'NETWORK_FEE_SNAPSHOT_EXPIRED',
        ]);
        throw new HttpException(
          {
            success: false,
            error: { code: error.code, message: 'A withdrawal fee quote is unavailable' },
          },
          unavailable.has(error.code) ? 503 : 422,
        );
      }
      throw error;
    }
  }
}
