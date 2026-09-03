import {
  FeeObservationSource,
  NetworkFeeEstimateRequest,
  NetworkFeeEstimator,
  NetworkFeeEstimatorResolver,
} from '../../../packages/domain/src';

export class DeterministicNetworkFeeEstimator implements NetworkFeeEstimator {
  constructor(
    private readonly source: FeeObservationSource,
    private readonly estimateAtomic: bigint,
  ) {}

  async estimate(input: NetworkFeeEstimateRequest): Promise<{
    estimatedNativeFeeAtomic: bigint;
    observedAt: Date;
    safeReference: string;
  }> {
    if (input.source !== this.source) throw new Error('FEE_ESTIMATOR_SOURCE_MISMATCH');
    return {
      estimatedNativeFeeAtomic: this.estimateAtomic,
      observedAt: input.now,
      safeReference: `deterministic:${this.source.toLowerCase()}`,
    };
  }
}

export class WorkerNetworkFeeEstimatorResolver implements NetworkFeeEstimatorResolver {
  constructor(
    private readonly provider: NetworkFeeEstimator,
    private readonly rpc: NetworkFeeEstimator,
  ) {}

  resolve(source: FeeObservationSource): NetworkFeeEstimator {
    return source === 'PROVIDER' ? this.provider : this.rpc;
  }
}
