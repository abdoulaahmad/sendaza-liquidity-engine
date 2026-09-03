import {
  NetworkFeeCalculationError,
  WithdrawalFeeQuoteCalculationError,
  calculateNetworkFee,
  calculateWithdrawalFeeQuote,
  NetworkFeeRepository,
  StoredWithdrawalFeeQuote,
  WithdrawalFeeQuoteService,
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

describe('WithdrawalFeeQuoteService', () => {
  const now = new Date('2026-09-03T08:00:00.000Z');
  const stored: StoredWithdrawalFeeQuote = {
    id: 'quote-1',
    assetNetworkId: 'asset-network-1',
    transferType: 'TOKEN',
    feeSnapshotId: 'snapshot-1',
    customerReference: 'customer-1',
    destinationAddress: 'destination-1',
    principalAtomic: 25_000_000n,
    estimatedNativeFeeAtomic: 100_000n,
    bufferedNativeFeeAtomic: 120_000n,
    networkFeeAtomic: 300_000n,
    fixedServiceFeeAtomic: 10_000n,
    percentageServiceFeeAtomic: 250_000n,
    serviceFeeAtomic: 260_000n,
    totalDebitAtomic: 25_560_000n,
    recipientAmountAtomic: 25_000_000n,
    assetDecimals: 6,
    nativeFeeAssetDecimals: 8,
    roundingMode: 'CEILING',
    expiresAt: new Date(now.getTime() + 30_000),
    createdAt: now,
  };
  const repository: NetworkFeeRepository = {
    loadPolicy: jest.fn(),
    saveRefresh: jest.fn(),
    loadQuoteContext: jest.fn().mockResolvedValue({
      assetNetworkId: 'asset-network-1',
      transferType: 'TOKEN',
      assetDecimals: 6,
      nativeFeeAssetDecimals: 8,
      minPrincipalAtomic: 1_000_000n,
      maxPrincipalAtomic: 100_000_000n,
      fixedServiceFeeAtomic: 10_000n,
      percentageServiceFeeBps: 100,
      quoteTtlSeconds: 30,
      snapshot: {
        id: 'snapshot-1',
        policyId: 'policy-1',
        assetNetworkId: 'asset-network-1',
        status: 'ACCEPTED',
        calculation: {
          estimatedNativeFeeAtomic: 100_000n,
          percentageBufferAtomic: 20_000n,
          fixedBufferAtomic: 0n,
          bufferedNativeFeeAtomic: 120_000n,
          chargedNetworkFeeAtomic: 300_000n,
          deviationBps: 0,
          roundingMode: 'CEILING',
        },
        calculatedAt: now,
        expiresAt: new Date(now.getTime() + 30_000),
      },
    }),
    insertQuote: jest.fn().mockResolvedValue(stored),
  };

  it('returns decimal strings in the correct asset precision', async () => {
    await expect(
      new WithdrawalFeeQuoteService(repository, () => now).create({
        assetNetworkId: 'asset-network-1',
        transferType: 'TOKEN',
        amount: '25.000000',
        destinationAddress: 'destination-1',
        customerReference: 'customer-1',
      }),
    ).resolves.toEqual({
      feeQuoteId: 'quote-1',
      assetNetworkId: 'asset-network-1',
      transferType: 'TOKEN',
      principal: '25.000000',
      estimatedNativeFee: '0.00100000',
      bufferedNativeFee: '0.00120000',
      networkFee: '0.300000',
      serviceFee: '0.260000',
      totalDebit: '25.560000',
      recipientAmount: '25.000000',
      expiresAt: '2026-09-03T08:00:30.000Z',
    });
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
