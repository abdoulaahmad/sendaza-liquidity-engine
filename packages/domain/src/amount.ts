import Decimal from 'decimal.js';

const DECIMAL_STRING = /^(0|[1-9]\d*)(\.\d+)?$/;

export class AmountPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountPrecisionError';
  }
}

export function toAtomicUnits(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  if (!DECIMAL_STRING.test(value)) {
    throw new AmountPrecisionError('Amount must be a non-negative decimal string');
  }
  const scaled = new Decimal(value).mul(new Decimal(10).pow(decimals));
  if (!scaled.isInteger()) {
    throw new AmountPrecisionError(`Amount exceeds ${decimals} decimal places`);
  }
  return BigInt(scaled.toFixed(0));
}

export function fromAtomicUnits(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  if (decimals === 0) return `${negative ? '-' : ''}${digits}`;
  return `${negative ? '-' : ''}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new AmountPrecisionError('Decimals must be an integer between 0 and 255');
  }
}
