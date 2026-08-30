import { AmountPrecisionError, fromAtomicUnits, toAtomicUnits } from './amount';

describe('atomic unit conversion', () => {
  it.each([
    ['1', 0, 1n, '1'],
    ['200000.0000', 4, 2_000_000_000n, '200000.0000'],
    ['1.000001', 6, 1_000_001n, '1.000001'],
    ['0.000000000000000001', 18, 1n, '0.000000000000000001'],
  ])('round trips %s at %i decimals', (input, decimals, atomic, formatted) => {
    expect(toAtomicUnits(input, decimals)).toBe(atomic);
    expect(fromAtomicUnits(atomic, decimals)).toBe(formatted);
  });

  it('rejects excess precision instead of rounding', () => {
    expect(() => toAtomicUnits('1.0000001', 6)).toThrow(AmountPrecisionError);
  });

  it.each(['1e3', '-1', '1,000', 'NaN'])('rejects invalid input %s', (input) => {
    expect(() => toAtomicUnits(input, 6)).toThrow(AmountPrecisionError);
  });
});
