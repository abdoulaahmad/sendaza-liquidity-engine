export const CONTRACTS_PACKAGE = '@sle/contracts';

export interface CreateQuoteBody {
  readonly side: 'BUY';
  readonly marketId: string;
  readonly debitAmount: string;
}

export class ContractValidationError extends Error {
  constructor(readonly code: 'INVALID_REQUEST_BODY') {
    super(code);
    this.name = 'ContractValidationError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export function parseCreateQuoteBody(value: unknown): CreateQuoteBody {
  if (!isPlainObject(value)) throw new ContractValidationError('INVALID_REQUEST_BODY');
  const keys = Object.keys(value);
  const expected = ['debitAmount', 'marketId', 'side'];
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) {
    throw new ContractValidationError('INVALID_REQUEST_BODY');
  }
  if (
    value.side !== 'BUY' ||
    typeof value.marketId !== 'string' ||
    !UUID_PATTERN.test(value.marketId) ||
    typeof value.debitAmount !== 'string' ||
    !DECIMAL_PATTERN.test(value.debitAmount)
  ) {
    throw new ContractValidationError('INVALID_REQUEST_BODY');
  }
  return value as unknown as CreateQuoteBody;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
