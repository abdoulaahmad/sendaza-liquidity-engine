import { calculateBuyQuote, QuoteCalculationError, QuoteCalculationInput } from './quote';

const input = (overrides: Partial<QuoteCalculationInput> = {}): QuoteCalculationInput => ({
  totalDebitAtomic: 20_000_000n,
  minTotalDebitAtomic: 100n,
  maxTotalDebitAtomic: 100_000_000n,
  fixedFeeAtomic: 100_000n,
  percentageFeeBps: 100,
  spreadBps: 100,
  quoteFiatDecimals: 2,
  baseAssetDecimals: 18,
  referenceRate: '6000000.0000',
  rateDisplayScale: 4,
  ...overrides,
});

describe('calculateBuyQuote', () => {
  it('calculates the approved combined-fee total-debit example exactly', () => {
    expect(calculateBuyQuote(input())).toEqual({
      totalDebitAtomic: 20_000_000n,
      fixedFeeAtomic: 100_000n,
      percentageFeeAtomic: 200_000n,
      totalFeeAtomic: 300_000n,
      tradeAmountAtomic: 19_700_000n,
      destinationAmountAtomic: 32_508_250_825_082_508n,
      spreadAmountAtomic: 195_049n,
      percentageFeeBps: 100,
      spreadBps: 100,
      referenceRate: '6000000',
      customerRate: '6060000.000000000000000000000000000000',
      customerRateDisplay: '6060000.0000',
      feeRoundingMode: 'CEILING',
      destinationRoundingMode: 'FLOOR',
    });
  });

  it('rounds a fractional percentage fee upward to one fiat atomic unit', () => {
    expect(
      calculateBuyQuote(
        input({
          totalDebitAtomic: 101n,
          minTotalDebitAtomic: 1n,
          maxTotalDebitAtomic: 101n,
          fixedFeeAtomic: 0n,
          percentageFeeBps: 1,
          spreadBps: 0,
          quoteFiatDecimals: 0,
          baseAssetDecimals: 0,
          referenceRate: '1',
          rateDisplayScale: 2,
        }),
      ),
    ).toMatchObject({ percentageFeeAtomic: 1n, tradeAmountAtomic: 100n });
  });

  it('supports zero fees and zero spread', () => {
    expect(
      calculateBuyQuote(input({ fixedFeeAtomic: 0n, percentageFeeBps: 0, spreadBps: 0 })),
    ).toMatchObject({
      totalFeeAtomic: 0n,
      tradeAmountAtomic: 20_000_000n,
      spreadAmountAtomic: 0n,
      customerRate: '6000000.000000000000000000000000000000',
    });
  });

  it.each([
    ['fixed only', { fixedFeeAtomic: 100_000n, percentageFeeBps: 0 }, 100_000n],
    ['percentage only', { fixedFeeAtomic: 0n, percentageFeeBps: 100 }, 200_000n],
  ])('calculates %s policies', (_name, overrides, expectedTotalFee) => {
    expect(calculateBuyQuote(input(overrides)).totalFeeAtomic).toBe(expectedTotalFee);
  });

  it.each([100n, 100_000_000n])('accepts inclusive order boundary %s', (totalDebitAtomic) => {
    expect(
      calculateBuyQuote(
        input({
          totalDebitAtomic,
          fixedFeeAtomic: 0n,
          percentageFeeBps: 0,
          spreadBps: 0,
          baseAssetDecimals: 8,
          referenceRate: '1',
        }),
      ).totalDebitAtomic,
    ).toBe(totalDebitAtomic);
  });

  it('uses half-even only for the display rate', () => {
    expect(
      calculateBuyQuote(
        input({
          totalDebitAtomic: 10_000n,
          fixedFeeAtomic: 0n,
          percentageFeeBps: 0,
          spreadBps: 0,
          referenceRate: '1.005',
          baseAssetDecimals: 8,
          rateDisplayScale: 2,
        }),
      ).customerRateDisplay,
    ).toBe('1.00');
  });

  it.each([
    ['below minimum', { totalDebitAtomic: 99n }, 'ORDER_BELOW_MINIMUM'],
    ['above maximum', { totalDebitAtomic: 100_000_001n }, 'ORDER_ABOVE_MAXIMUM'],
    ['fees equal debit', { totalDebitAtomic: 100_000n }, 'FEES_EXCEED_DEBIT'],
    [
      'destination below one atomic unit',
      {
        totalDebitAtomic: 1n,
        minTotalDebitAtomic: 1n,
        fixedFeeAtomic: 0n,
        percentageFeeBps: 0,
        quoteFiatDecimals: 2,
        baseAssetDecimals: 0,
        referenceRate: '1000',
      },
      'DESTINATION_AMOUNT_TOO_SMALL',
    ],
  ])('rejects %s', (_name, overrides, code) => {
    expect(() => calculateBuyQuote(input(overrides))).toThrow(
      expect.objectContaining({ code }) as QuoteCalculationError,
    );
  });

  it.each([
    ['negative fee', { fixedFeeAtomic: -1n }],
    ['invalid percentage bps', { percentageFeeBps: 10_001 }],
    ['invalid spread bps', { spreadBps: -1 }],
    ['malformed rate', { referenceRate: '1e6' }],
    ['zero rate', { referenceRate: '0' }],
    ['invalid fiat scale', { quoteFiatDecimals: 256 }],
    ['invalid display scale', { rateDisplayScale: 31 }],
  ])('rejects %s as invalid configuration', (_name, overrides) => {
    expect(() => calculateBuyQuote(input(overrides))).toThrow(
      expect.objectContaining({ code: 'QUOTE_INPUT_INVALID' }) as QuoteCalculationError,
    );
  });

  it('rejects a destination amount that cannot fit PostgreSQL bigint', () => {
    expect(() =>
      calculateBuyQuote(
        input({
          totalDebitAtomic: 9_223_372_036_854_775_807n,
          maxTotalDebitAtomic: 9_223_372_036_854_775_807n,
          fixedFeeAtomic: 0n,
          percentageFeeBps: 0,
          spreadBps: 0,
          quoteFiatDecimals: 0,
          baseAssetDecimals: 18,
          referenceRate: '1',
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'QUOTE_AMOUNT_OVERFLOW' }) as QuoteCalculationError);
  });
});
