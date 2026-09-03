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

export interface CreatePurchaseBody {
  quoteId: string;
  customerReference: string;
  clientLockReference: string;
  clientReference: string;
}
export interface SettlePurchaseBody {
  status: 'COMMITTED' | 'ROLLED_BACK';
  clientSettlementReference: string;
  settledAt: string;
}

export function parseCreatePurchaseBody(value: unknown): CreatePurchaseBody {
  const keys = ['clientLockReference', 'clientReference', 'customerReference', 'quoteId'];
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => key in value)
  )
    throw new ContractValidationError('INVALID_REQUEST_BODY');
  if (typeof value.quoteId !== 'string' || !UUID_PATTERN.test(value.quoteId))
    throw new ContractValidationError('INVALID_REQUEST_BODY');
  for (const key of keys.slice(0, 3)) {
    const item = value[key];
    if (typeof item !== 'string' || item.length < 1 || item.length > 100)
      throw new ContractValidationError('INVALID_REQUEST_BODY');
  }
  return value as unknown as CreatePurchaseBody;
}

export function parseSettlePurchaseBody(value: unknown): SettlePurchaseBody {
  const keys = ['clientSettlementReference', 'settledAt', 'status'];
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => key in value)
  )
    throw new ContractValidationError('INVALID_REQUEST_BODY');
  if (value.status !== 'COMMITTED' && value.status !== 'ROLLED_BACK')
    throw new ContractValidationError('INVALID_REQUEST_BODY');
  if (
    typeof value.clientSettlementReference !== 'string' ||
    value.clientSettlementReference.length < 1 ||
    value.clientSettlementReference.length > 100
  )
    throw new ContractValidationError('INVALID_REQUEST_BODY');
  if (
    typeof value.settledAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value.settledAt) ||
    Number.isNaN(Date.parse(value.settledAt))
  )
    throw new ContractValidationError('INVALID_REQUEST_BODY');
  return value as unknown as SettlePurchaseBody;
}

export interface CreateWithdrawalFeeQuoteBody {
  readonly assetNetworkId: string;
  readonly transferType: 'NATIVE' | 'TOKEN';
  readonly amount: string;
  readonly destinationAddress: string;
  readonly customerReference: string;
}

export function parseCreateWithdrawalFeeQuoteBody(value: unknown): CreateWithdrawalFeeQuoteBody {
  const keys = [
    'amount',
    'assetNetworkId',
    'customerReference',
    'destinationAddress',
    'transferType',
  ];
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => key in value)
  ) {
    throw new ContractValidationError('INVALID_REQUEST_BODY');
  }
  if (
    typeof value.assetNetworkId !== 'string' ||
    !UUID_PATTERN.test(value.assetNetworkId) ||
    (value.transferType !== 'NATIVE' && value.transferType !== 'TOKEN') ||
    typeof value.amount !== 'string' ||
    !DECIMAL_PATTERN.test(value.amount) ||
    typeof value.destinationAddress !== 'string' ||
    value.destinationAddress.length < 1 ||
    value.destinationAddress.length > 255 ||
    typeof value.customerReference !== 'string' ||
    value.customerReference.length < 1 ||
    value.customerReference.length > 100
  ) {
    throw new ContractValidationError('INVALID_REQUEST_BODY');
  }
  return value as unknown as CreateWithdrawalFeeQuoteBody;
}
