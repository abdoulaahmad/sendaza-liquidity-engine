import { Body, Controller, HttpException, Post } from '@nestjs/common';
import { ContractValidationError, parseCreateQuoteBody } from '../../../packages/contracts/src';
import { BuyQuoteView, QuoteCreationError, QuoteService } from '../../../packages/domain/src';
import { AuditOperation } from './audit-operation.decorator';
import { IdempotentOperation } from './idempotent-operation.decorator';

@Controller('quotes')
export class QuoteController {
  constructor(private readonly quotes: QuoteService) {}

  @Post()
  @AuditOperation('quotes.create')
  @IdempotentOperation('quotes.create')
  async create(@Body() body: unknown): Promise<{ success: true; data: BuyQuoteView }> {
    try {
      const request = parseCreateQuoteBody(body);
      return { success: true, data: await this.quotes.createBuyQuote(request) };
    } catch (error: unknown) {
      if (error instanceof ContractValidationError) {
        throw failure(400, error.code, 'The quote request body is invalid');
      }
      if (error instanceof QuoteCreationError) throw quoteFailure(error);
      throw error;
    }
  }
}

function quoteFailure(error: QuoteCreationError): HttpException {
  const unavailable = new Set([
    'QUOTE_POLICY_UNAVAILABLE',
    'REFERENCE_RATE_UNAVAILABLE',
    'REFERENCE_RATE_EXPIRED',
  ]);
  const status = error.code === 'MARKET_DISABLED' ? 409 : unavailable.has(error.code) ? 503 : 422;
  return failure(status, error.code, 'An executable purchase quote could not be created');
}

function failure(status: number, code: string, message: string): HttpException {
  return new HttpException({ success: false, error: { code, message } }, status);
}
