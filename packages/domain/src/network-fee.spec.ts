import {
  NetworkFeeCalculationError,
  WithdrawalFeeQuoteCalculationError,
  calculateNetworkFee,
  calculateWithdrawalFeeQuote,
} from './network-fee';

describe('calculateNetworkFee', () => {
  const now = new Date('2026-09-03T08:00:00.000Z');
  const input = {
    observations: [
      {
        source: 'PROVIDER' as const,
        estimatedNativeFeeAtomic: 100n,
        observedAt: now,
        expiresAt: new Date(now.getTime() + 30_000),
      },
      {
        source: 'RPC' as const,
        estimatedNativeFeeAtomic: 105n,
        observedAt: now,
        expiresAt: new Date(now.getTime() + 30_000),
      },
    ],
    requiredObservations: 2,
    maxDeviationBps: 500,
    percentageBufferBps: 1_000,
    fixedBufferAtomic: 3n,
    conversionNumerator: 5n,
    conversionDenominator: 2n,
    now,
  };

  it('uses the conservative estimate and rounds buffers and conversion upward', () => {
    expect(calculateNetworkFee(input)).toEqual({
      estimatedNativeFeeAtomic: 105n,
      percentageBufferAtomic: 11n,
      fixedBufferAtomic: 3n,
      bufferedNativeFeeAtomic: 119n,
      chargedNetworkFeeAtomic: 298n,
      deviationBps: 500,
      roundingMode: 'CEILING',
    });
  });

  it('rejects stale, duplicate, missing, and deviating evidence', () => {
    expect(() =>
      calculateNetworkFee({ ...input, observations: input.observations.slice(0, 1) }),
    ).toThrow(new NetworkFeeCalculationError('FEE_OBSERVATIONS_MISSING'));
    expect(() =>
      calculateNetworkFee({
        ...input,
        observations: input.observations.map((item) => ({ ...item, source: 'RPC' as const })),
      }),
    ).toThrow(new NetworkFeeCalculationError('FEE_OBSERVATION_SOURCES_DUPLICATED'));
    expect(() =>
      calculateNetworkFee({
        ...input,
        observations: input.observations.map((item) => ({ ...item, expiresAt: now })),
      }),
    ).toThrow(new NetworkFeeCalculationError('FEE_OBSERVATION_EXPIRED'));
    expect(() => calculateNetworkFee({ ...input, maxDeviationBps: 499 })).toThrow(
      new NetworkFeeCalculationError('FEE_ESTIMATE_DEVIATION_EXCEEDED'),
    );
  });
});

describe('calculateWithdrawalFeeQuote', () => {
  it('keeps recipient principal exact and adds rounded fees to total debit', () => {
    expect(
      calculateWithdrawalFeeQuote({
        principalAtomic: 10_001n,
        minPrincipalAtomic: 1_000n,
        maxPrincipalAtomic: 100_000n,
        chargedNetworkFeeAtomic: 300n,
        fixedServiceFeeAtomic: 20n,
        percentageServiceFeeBps: 100,
      }),
    ).toEqual({
      principalAtomic: 10_001n,
      networkFeeAtomic: 300n,
      fixedServiceFeeAtomic: 20n,
      percentageServiceFeeAtomic: 101n,
      serviceFeeAtomic: 121n,
      totalDebitAtomic: 10_422n,
      recipientAmountAtomic: 10_001n,
      roundingMode: 'CEILING',
    });
  });

  it('rejects values outside configured limits', () => {
    expect(() =>
      calculateWithdrawalFeeQuote({
        principalAtomic: 999n,
        minPrincipalAtomic: 1_000n,
        maxPrincipalAtomic: 100_000n,
        chargedNetworkFeeAtomic: 300n,
        fixedServiceFeeAtomic: 20n,
        percentageServiceFeeBps: 100,
      }),
    ).toThrow(new WithdrawalFeeQuoteCalculationError('WITHDRAWAL_BELOW_MINIMUM'));
  });
});
