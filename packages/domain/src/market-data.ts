import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';

const RATE_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const RateDecimal = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_EVEN });

export const MARKET_DATA_FAILURE_CODES = [
  'PRICE_OBSERVATION_INVALID',
  'PRICE_LEG_MISSING',
  'PRICE_LEG_STALE',
  'PRICE_SEQUENCE_GAP',
  'PRICE_ROUTE_INVALID',
  'PRICE_ROUTE_DEVIATION',
  'STABLECOIN_REFERENCE_UNSAFE',
] as const;

export type MarketDataFailureCode = (typeof MARKET_DATA_FAILURE_CODES)[number];
export type RouteLegOperation = 'MULTIPLY' | 'DIVIDE';

export interface PriceProvider {
  fetch(request: PriceRequest): Promise<PriceObservationInput>;
}

export class PriceProviderError extends Error {
  constructor(
    readonly code: 'PRICE_PROVIDER_UNAVAILABLE' | 'PRICE_OBSERVATION_INVALID',
  ) {
    super(code);
    this.name = 'PriceProviderError';
  }
}

export interface PriceRequest {
  readonly providerPairCode: string;
}

export interface PriceObservationInput {
  readonly price: string;
  readonly observedAt: Date;
  readonly providerSequence?: string;
}

export interface StoredPriceObservation {
  readonly id: string;
  readonly providerPairId: string;
  readonly rate: string;
  readonly priceScale: number;
  readonly pairMaxAgeSeconds: number;
  readonly observedAt: Date;
  readonly providerSequence?: string;
  readonly deduplicationKey?: string;
  readonly sequenceGap?: boolean;
}

export interface ConversionRouteDefinition {
  readonly id: string;
  readonly version: number;
  readonly outputScale: number;
  readonly maxAgeSeconds: number;
  readonly maxDeviationBps: number;
  readonly legs: readonly ConversionRouteLegDefinition[];
  readonly stablecoinGuard?: StablecoinGuardDefinition;
}

export interface ConversionRouteLegDefinition {
  readonly id: string;
  readonly sequence: number;
  readonly providerPairId: string;
  readonly operation: RouteLegOperation;
}

export interface StablecoinGuardDefinition {
  readonly providerPairId: string;
  readonly expectedRate: string;
  readonly toleranceBps: number;
}

export interface PreviousAcceptedRate {
  readonly rate: string;
}

export interface AcceptedReferenceRate {
  readonly status: 'ACCEPTED';
  readonly routeId: string;
  readonly routeVersion: number;
  readonly rate: string;
  readonly outputScale: number;
  readonly roundingMode: 'HALF_EVEN';
  readonly calculatedAt: Date;
  readonly validUntil: Date;
  readonly inputs: readonly ReferenceRateInput[];
  readonly guardObservationId?: string;
}

export interface RejectedReferenceRate {
  readonly status: 'REJECTED';
  readonly routeId: string;
  readonly routeVersion: number;
  readonly failureCode: MarketDataFailureCode;
  readonly outputScale: number;
  readonly roundingMode: 'HALF_EVEN';
  readonly calculatedAt: Date;
  readonly inputs: readonly ReferenceRateInput[];
  readonly guardObservationId?: string;
}

export interface ReferenceRateInput {
  readonly routeLegId: string;
  readonly observationId: string;
}

export type ReferenceRateEvaluation = AcceptedReferenceRate | RejectedReferenceRate;

export function evaluateReferenceRate(
  route: ConversionRouteDefinition,
  observations: readonly StoredPriceObservation[],
  calculatedAt: Date,
  previous?: PreviousAcceptedRate,
): ReferenceRateEvaluation {
  const reject = (
    failureCode: MarketDataFailureCode,
    inputs: readonly ReferenceRateInput[] = [],
    guardObservationId?: string,
  ): RejectedReferenceRate => ({
    status: 'REJECTED',
    routeId: route.id,
    routeVersion: route.version,
    failureCode,
    outputScale: route.outputScale,
    roundingMode: 'HALF_EVEN',
    calculatedAt,
    inputs,
    ...(guardObservationId ? { guardObservationId } : {}),
  });

  if (!isValidRoute(route) || !isValidDate(calculatedAt)) {
    return reject('PRICE_ROUTE_INVALID');
  }

  const latestByPair = selectLatestByPair(observations);
  const inputs: ReferenceRateInput[] = [];
  let candidate = new RateDecimal(1);
  let validUntil = new Date(calculatedAt.getTime() + route.maxAgeSeconds * 1000);
  let guardObservationId: string | undefined;

  for (const leg of route.legs) {
    const observation = latestByPair.get(leg.providerPairId);
    if (!observation) return reject('PRICE_LEG_MISSING', inputs);
    if (!isValidObservation(observation)) return reject('PRICE_OBSERVATION_INVALID', inputs);
    inputs.push({ routeLegId: leg.id, observationId: observation.id });
    if (observation.sequenceGap) return reject('PRICE_SEQUENCE_GAP', inputs);
    if (isStale(observation, route.maxAgeSeconds, calculatedAt)) {
      return reject('PRICE_LEG_STALE', inputs);
    }
    validUntil = earlierDate(validUntil, observationExpiry(observation, route.maxAgeSeconds));
    const rate = new RateDecimal(observation.rate);
    candidate = leg.operation === 'MULTIPLY' ? candidate.times(rate) : candidate.dividedBy(rate);
  }

  if (route.stablecoinGuard) {
    const guardObservation = latestByPair.get(route.stablecoinGuard.providerPairId);
    if (!guardObservation) return reject('STABLECOIN_REFERENCE_UNSAFE', inputs);
    guardObservationId = guardObservation.id;
    if (!isValidObservation(guardObservation)) {
      return reject('PRICE_OBSERVATION_INVALID', inputs, guardObservationId);
    }
    if (
      guardObservation.sequenceGap ||
      isStale(guardObservation, route.maxAgeSeconds, calculatedAt) ||
      exceedsBasisPointTolerance(
        new RateDecimal(guardObservation.rate),
        new RateDecimal(route.stablecoinGuard.expectedRate),
        route.stablecoinGuard.toleranceBps,
      )
    ) {
      return reject('STABLECOIN_REFERENCE_UNSAFE', inputs, guardObservationId);
    }
    validUntil = earlierDate(
      validUntil,
      observationExpiry(guardObservation, route.maxAgeSeconds),
    );
  }

  if (previous) {
    if (!isPositiveRate(previous.rate)) return reject('PRICE_ROUTE_INVALID', inputs);
    if (
      exceedsBasisPointTolerance(candidate, new RateDecimal(previous.rate), route.maxDeviationBps)
    ) {
      return reject('PRICE_ROUTE_DEVIATION', inputs, guardObservationId);
    }
  }

  const normalizedRate = candidate.toFixed(route.outputScale, Decimal.ROUND_HALF_EVEN);
  if ((normalizedRate.split('.')[0]?.length ?? 0) > 30) {
    return reject('PRICE_ROUTE_INVALID', inputs, guardObservationId);
  }

  return {
    status: 'ACCEPTED',
    routeId: route.id,
    routeVersion: route.version,
    rate: normalizedRate,
    outputScale: route.outputScale,
    roundingMode: 'HALF_EVEN',
    calculatedAt,
    validUntil,
    inputs,
    ...(guardObservationId ? { guardObservationId } : {}),
  };
}

export interface NewPriceObservation {
  readonly providerPairId: string;
  readonly normalizedRate: string;
  readonly rawRate: string;
  readonly providerObservedAt: Date;
  readonly providerSequence?: string;
  readonly sequenceGap?: boolean;
  readonly deduplicationKey: string;
  readonly safeProviderReference?: string;
  readonly receivedAt: Date;
}

export interface ProviderPairIngestionPolicy {
  readonly id: string;
  readonly priceScale: number;
  readonly sequenceEnforced: boolean;
}

export type PriceProviderKind = 'COINBASE_PUBLIC' | 'MANUAL' | 'DETERMINISTIC_FAKE';

export interface ProviderPairSource extends ProviderPairIngestionPolicy {
  readonly providerPairCode: string;
  readonly providerKind: PriceProviderKind;
}

export abstract class PriceProviderResolver {
  abstract resolve(kind: PriceProviderKind): PriceProvider | null;
}

export interface MarketRefreshResult {
  readonly marketId: string;
  readonly snapshotId: string;
  readonly evaluation: ReferenceRateEvaluation;
  readonly providerFailures: number;
}

export type ObservationIngestionResult =
  | { readonly status: 'INSERTED'; readonly observationId: string }
  | { readonly status: 'DUPLICATE'; readonly observationId: string }
  | { readonly status: 'SEQUENCE_GAP'; readonly observationId: string };

export interface ActiveManualPrice {
  readonly rate: string;
  readonly effectiveFrom: Date;
  readonly version: number;
}

export abstract class PricingRepository {
  abstract findEnabledRoute(marketId: string): Promise<ConversionRouteDefinition | null>;
  abstract findLatestObservations(
    providerPairIds: readonly string[],
  ): Promise<readonly StoredPriceObservation[]>;
  abstract findPreviousAcceptedRate(routeId: string): Promise<PreviousAcceptedRate | null>;
  abstract findActiveManualPrice(
    providerPairCode: string,
    at: Date,
  ): Promise<ActiveManualPrice | null>;
  abstract findProviderPairSources(
    providerPairIds: readonly string[],
  ): Promise<readonly ProviderPairSource[]>;
  abstract insertObservation(
    observation: NewPriceObservation,
  ): Promise<{ readonly id: string; readonly inserted: boolean }>;
  abstract findLatestObservationForPair(
    providerPairId: string,
  ): Promise<StoredPriceObservation | null>;
  abstract findObservationByDeduplicationKey(
    providerPairId: string,
    deduplicationKey: string,
  ): Promise<StoredPriceObservation | null>;
  abstract findObservationByProviderSequence(
    providerPairId: string,
    providerSequence: string,
  ): Promise<StoredPriceObservation | null>;
  abstract saveEvaluation(evaluation: ReferenceRateEvaluation): Promise<string>;
}

export class MarketDataRefreshService {
  private readonly ingestion: ObservationIngestionService;

  constructor(
    private readonly repository: PricingRepository,
    private readonly providers: PriceProviderResolver,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.ingestion = new ObservationIngestionService(repository);
  }

  async refreshMarket(marketId: string): Promise<MarketRefreshResult> {
    const route = await this.repository.findEnabledRoute(marketId);
    if (!route) throw new PriceProviderError('PRICE_OBSERVATION_INVALID');
    const pairIds = uniqueRoutePairIds(route);
    const sources = await this.repository.findProviderPairSources(pairIds);
    let providerFailures = pairIds.length - sources.length;

    for (const source of sources) {
      const provider = this.providers.resolve(source.providerKind);
      if (!provider) {
        providerFailures += 1;
        continue;
      }
      let input: PriceObservationInput;
      try {
        input = await provider.fetch({ providerPairCode: source.providerPairCode });
      } catch {
        providerFailures += 1;
        continue;
      }
      try {
        await this.ingestion.ingest(source, input, this.now());
      } catch (error: unknown) {
        if (!(error instanceof PriceProviderError)) throw error;
        providerFailures += 1;
      }
    }

    const observations = await this.repository.findLatestObservations(pairIds);
    const previous = await this.repository.findPreviousAcceptedRate(route.id);
    const evaluation = evaluateReferenceRate(route, observations, this.now(), previous ?? undefined);
    const snapshotId = await this.repository.saveEvaluation(evaluation);
    return { marketId, snapshotId, evaluation, providerFailures };
  }
}

function uniqueRoutePairIds(route: ConversionRouteDefinition): readonly string[] {
  return [
    ...new Set([
      ...route.legs.map((leg) => leg.providerPairId),
      ...(route.stablecoinGuard ? [route.stablecoinGuard.providerPairId] : []),
    ]),
  ];
}

export class ObservationIngestionService {
  constructor(private readonly repository: PricingRepository) {}

  async ingest(
    policy: ProviderPairIngestionPolicy,
    input: PriceObservationInput,
    receivedAt: Date,
  ): Promise<ObservationIngestionResult> {
    this.validate(policy, input, receivedAt);
    const deduplicationKey = createObservationDeduplicationKey(policy.id, input);
    const duplicate = await this.repository.findObservationByDeduplicationKey(
      policy.id,
      deduplicationKey,
    );
    if (duplicate) return { status: 'DUPLICATE', observationId: duplicate.id };

    let sequenceGap = false;
    if (policy.sequenceEnforced) {
      const sequence = input.providerSequence!;
      const existingSequence = await this.repository.findObservationByProviderSequence(
        policy.id,
        sequence,
      );
      if (existingSequence) throw new PriceProviderError('PRICE_OBSERVATION_INVALID');
      const previous = await this.repository.findLatestObservationForPair(policy.id);
      if (previous?.providerSequence) {
        sequenceGap = BigInt(sequence) !== BigInt(previous.providerSequence) + 1n;
      }
    }

    const persisted = await this.repository.insertObservation({
      providerPairId: policy.id,
      normalizedRate: input.price,
      rawRate: input.price,
      providerObservedAt: input.observedAt,
      ...(input.providerSequence ? { providerSequence: input.providerSequence } : {}),
      ...(sequenceGap ? { sequenceGap: true } : {}),
      deduplicationKey,
      receivedAt,
    });
    if (!persisted.inserted) return { status: 'DUPLICATE', observationId: persisted.id };
    return {
      status: sequenceGap ? 'SEQUENCE_GAP' : 'INSERTED',
      observationId: persisted.id,
    };
  }

  private validate(
    policy: ProviderPairIngestionPolicy,
    input: PriceObservationInput,
    receivedAt: Date,
  ): void {
    const fractionLength = input.price.split('.')[1]?.length ?? 0;
    if (
      !policy.id ||
      !Number.isInteger(policy.priceScale) ||
      policy.priceScale < 0 ||
      policy.priceScale > 30 ||
      !isPositiveRate(input.price) ||
      fractionLength > policy.priceScale ||
      !isValidDate(input.observedAt) ||
      !isValidDate(receivedAt) ||
      input.observedAt.getTime() > receivedAt.getTime() + 5 * 60 * 1000 ||
      (policy.sequenceEnforced && !isPositiveInteger(input.providerSequence))
    ) {
      throw new PriceProviderError('PRICE_OBSERVATION_INVALID');
    }
  }
}

export function createObservationDeduplicationKey(
  providerPairId: string,
  input: PriceObservationInput,
): string {
  return createHash('sha256')
    .update(providerPairId)
    .update('\n')
    .update(input.price)
    .update('\n')
    .update(input.observedAt.toISOString())
    .update('\n')
    .update(input.providerSequence ?? '')
    .digest('hex');
}

function isPositiveInteger(value: string | undefined): value is string {
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value);
}

function selectLatestByPair(
  observations: readonly StoredPriceObservation[],
): Map<string, StoredPriceObservation> {
  const result = new Map<string, StoredPriceObservation>();
  for (const observation of observations) {
    const current = result.get(observation.providerPairId);
    if (!current || observation.observedAt.getTime() > current.observedAt.getTime()) {
      result.set(observation.providerPairId, observation);
    }
  }
  return result;
}

function isValidRoute(route: ConversionRouteDefinition): boolean {
  if (
    !Number.isInteger(route.version) ||
    route.version <= 0 ||
    !Number.isInteger(route.outputScale) ||
    route.outputScale < 0 ||
    route.outputScale > 30 ||
    !Number.isInteger(route.maxAgeSeconds) ||
    route.maxAgeSeconds <= 0 ||
    !isBasisPoints(route.maxDeviationBps) ||
    route.legs.length === 0
  ) {
    return false;
  }
  if (route.stablecoinGuard) {
    if (
      !isPositiveRate(route.stablecoinGuard.expectedRate) ||
      !isBasisPoints(route.stablecoinGuard.toleranceBps)
    ) {
      return false;
    }
  }
  return route.legs.every(
    (leg, index) =>
      leg.sequence === index + 1 &&
      leg.id.length > 0 &&
      leg.providerPairId.length > 0 &&
      (leg.operation === 'MULTIPLY' || leg.operation === 'DIVIDE'),
  );
}

function isValidObservation(observation: StoredPriceObservation): boolean {
  if (
    !observation.id ||
    !observation.providerPairId ||
    !isPositiveRate(observation.rate) ||
    !Number.isInteger(observation.priceScale) ||
    observation.priceScale < 0 ||
    observation.priceScale > 30 ||
    !Number.isInteger(observation.pairMaxAgeSeconds) ||
    observation.pairMaxAgeSeconds <= 0 ||
    !isValidDate(observation.observedAt)
  ) {
    return false;
  }
  const fractionalLength = observation.rate.split('.')[1]?.length ?? 0;
  return fractionalLength <= observation.priceScale;
}

function isStale(
  observation: StoredPriceObservation,
  routeMaxAgeSeconds: number,
  calculatedAt: Date,
): boolean {
  const ageMilliseconds = calculatedAt.getTime() - observation.observedAt.getTime();
  const allowedAgeMilliseconds =
    Math.min(routeMaxAgeSeconds, observation.pairMaxAgeSeconds) * 1000;
  return ageMilliseconds < 0 || ageMilliseconds > allowedAgeMilliseconds;
}

function observationExpiry(
  observation: StoredPriceObservation,
  routeMaxAgeSeconds: number,
): Date {
  const allowedAgeSeconds = Math.min(routeMaxAgeSeconds, observation.pairMaxAgeSeconds);
  return new Date(observation.observedAt.getTime() + allowedAgeSeconds * 1000);
}

function earlierDate(first: Date, second: Date): Date {
  return first.getTime() <= second.getTime() ? first : second;
}

function exceedsBasisPointTolerance(
  candidate: Decimal,
  reference: Decimal,
  toleranceBps: number,
): boolean {
  return candidate.minus(reference).abs().dividedBy(reference).times(10_000).gt(toleranceBps);
}

function isPositiveRate(value: string): boolean {
  if (!RATE_PATTERN.test(value)) return false;
  try {
    return new RateDecimal(value).gt(0);
  } catch {
    return false;
  }
}

function isBasisPoints(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 10_000;
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}
