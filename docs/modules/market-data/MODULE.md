# Market Data And Conversion Routes Module

## Purpose And Ownership

This module obtains external and manual reference prices, stores immutable source
observations, evaluates configured direct or multi-leg conversion routes, and
publishes reproducible reference-rate snapshots for the quote engine.

It does not calculate customer spreads or purchase fees, issue executable quotes,
reserve inventory, move customer balances, or select custody networks. Those
responsibilities belong to later modules.

## Sprint 3 Scope

- Domain-owned price-provider interface
- Deterministic fake provider for tests
- Coinbase public reference-price adapter for illustrative crypto pairs
- Versioned manual provider for the free-MVP fiat cross-rate
- Normalized pricing instruments and provider pair mappings
- Immutable source observations with provider timestamps and optional sequences
- Versioned direct and multi-leg conversion routes
- Staleness, deviation, sequence-gap, and configured stablecoin-depeg guards
- Reproducible reference-rate snapshots linked to every input observation
- Worker refresh orchestration with retry-safe database persistence

Executable purchase quotes, customer economics, redundant production pricing,
order-book depth, trading execution, and automatic provider onboarding are
excluded.

## Concepts For Junior Developers

A **price observation** is one provider fact, such as `1 USDT = 1.00 USD`, with
the time the provider measured it. A **route** explains how facts combine. For
example, `ETH/USDT` multiplied by `USDT/USD` and `USD/NGN` produces `ETH/NGN`.
A **snapshot** is the final stored result plus links to all facts used to produce
it. The links let another engineer reproduce and audit the calculation later.

## Domain Interfaces

```typescript
interface PriceProvider {
  fetch(request: PriceRequest): Promise<PriceObservationInput>;
}

interface PriceRequest {
  providerPairCode: string;
}

interface PriceObservationInput {
  price: string;
  observedAt: Date;
  providerSequence?: string;
}
```

Provider adapters return decimal strings. Vendor response types and SDKs stay
inside adapters. Domain and application services never depend on Coinbase or
another vendor type.

## Data Model

### `pricing_providers`

Stores provider code, adapter type, enabled state, and a non-secret configuration
reference. Credentials or populated provider configuration never enter the table.

### `pricing_instruments`

Normalizes an asset or fiat currency into one route node. Exactly one of
`asset_id` and `fiat_currency_id` is populated. This avoids hardcoded branches for
ETH, USDT, USD, or NGN.

### `provider_price_pairs`

Maps a provider pair code to base and quote instruments. It also stores source
precision, maximum age, optional sequence enforcement, and enabled state.

### `price_observations`

Immutable provider facts containing provider pair, normalized price, exact raw
price text, provider observation time, optional sequence, receipt time, and safe
provider reference. Duplicate provider evidence is rejected by a provider-pair
deduplication key.

### `conversion_routes` and `conversion_route_legs`

A route belongs to a configured SLE market and configuration version. Ordered
legs reference provider pairs and declare `MULTIPLY` or `DIVIDE`. Route policy
contains output scale, staleness limit, maximum deviation, and stablecoin guard
configuration. Enabled routes have at least one contiguous leg.

### `reference_rate_snapshots` and inputs

A snapshot stores the evaluated reference rate, explicit output scale and
rounding mode, route version, calculation time, state, and rejection reason.
Snapshot inputs link each ordered route leg to the exact observation used.

### `manual_price_versions`

Stores reviewed, effective-dated manual observations for the free-MVP test
cross-rate. Updates create another version; prior values are immutable.

## Exact Rate Arithmetic

- Provider prices enter as validated decimal strings, never JSON numbers.
- Domain evaluation uses `decimal.js` with reviewed precision.
- Source values must be positive and fit the configured provider-pair precision.
- Multiplication and division retain working precision across all route legs.
- The final reference rate is normalized only once to the route `output_scale`
  using explicit `ROUND_HALF_EVEN`.
- The snapshot records scale and rounding mode so the result is reproducible.
- Rate rounding never rounds customer principal; Sprint 4 performs customer
  amount conversion under its own reviewed rules.

## Evaluation Flow

```text
provider adapters or manual version
  -> validate and persist immutable observations
  -> select latest safe observation for every ordered route leg
  -> apply MULTIPLY or DIVIDE with decimal.js
  -> run route safety guards
  -> normalize once at configured scale
  -> persist snapshot and all observation links atomically
  -> expose snapshot ID to the later quote engine
```

## Safety Guards

### Staleness

Every observation must be within both its provider-pair age limit and the route
age limit at calculation time. A stale or missing leg rejects the route.

### Deviation

The candidate rate is compared with the last accepted snapshot for the same
route. Deviation uses exact decimal arithmetic and configured basis points. A
candidate outside the limit is stored as rejected evidence and cannot price a
quote.

### Sequence

When a provider exposes a monotonic sequence, duplicates are idempotent and a
gap or backwards sequence makes that pair unsafe until refreshed or reconciled.
Providers without sequences rely on deduplication and timestamps.

### Stablecoin Reference

A route may identify a stablecoin-to-reference-fiat guard pair, expected price,
and tolerance basis points. If the latest fresh guard observation is outside the
configured band, every dependent route is rejected. No symbol is automatically
treated as stable merely because it is named USDT or USDC.

## Stable Failures

- `PRICE_OBSERVATION_INVALID`
- `PRICE_OBSERVATION_DUPLICATE`
- `PRICE_LEG_MISSING`
- `PRICE_LEG_STALE`
- `PRICE_SEQUENCE_GAP`
- `PRICE_ROUTE_INVALID`
- `PRICE_ROUTE_DEVIATION`
- `STABLECOIN_REFERENCE_UNSAFE`
- `PRICE_PROVIDER_UNAVAILABLE`

Provider timeouts or malformed responses do not overwrite the last observation.
The last accepted snapshot remains historical evidence but cannot be consumed
after its freshness deadline.

## Security And Operations

- Provider endpoints and pair codes are trusted server-side configuration.
- Sendaza cannot choose a provider, route, stablecoin policy, or manual price.
- Logs exclude provider credentials and complete raw payloads.
- Manual versions record actor, reason, effective time, and configuration version.
- Metrics include pair age, route age, provider failures, rejected observations,
  deviation, sequence gaps, and stablecoin guard state.
- The free MVP uses single-source pricing and is not approved for real funds.
  Redundant independent production sources are a launch gate.

## Acceptance Criteria

- Direct and multi-leg rates are reproducible from stored observations.
- Reordering, removing, or changing a route leg changes the route version.
- No asset, fiat, stablecoin, or provider symbol is hardcoded in evaluation.
- Stale, missing, deviating, sequence-gap, or depegged inputs cannot produce an
  accepted reference snapshot.
- Concurrent refreshes do not duplicate provider evidence or accepted snapshots.
- Provider timeout and process restart preserve previously committed evidence.
- Unit tests cover exact route arithmetic and every guard.
- Real PostgreSQL tests cover immutability, uniqueness, route/input transactions,
  and concurrent refresh behavior.

## Dependencies And Next Sprint

Sprint 1 supplies assets, fiat currencies, markets, and configuration versions.
Sprint 2 supplies authentication, idempotency, audit, and durable workers. Sprint
3 supplies reference snapshots. Sprint 4 consumes snapshot IDs to create
immutable executable quotes with SLE-owned spreads and fees.
