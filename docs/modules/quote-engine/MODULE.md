# Executable Quote Engine Module

## Purpose and Ownership

The Quote Engine turns one accepted, unexpired Sprint 3 reference-rate snapshot
into an immutable purchase quote for Sendaza Core. It owns purchase spreads,
fixed and percentage purchase fees, order-limit enforcement, exact amount
calculation, quote expiry, and reproducible quote evidence.

It does not authenticate customers, lock customer fiat, reserve treasury
inventory, post Sendaza ledger entries, execute a purchase, or move crypto.
A quote is a short-lived offer, not a purchase or inventory reservation.

## Sprint 4 Scope

- Versioned quote policies by configured market
- BUY quotes where Sendaza supplies the total fiat debit
- Fixed and percentage purchase fees in the market quote fiat
- Basis-point spread applied to an accepted reference rate
- Exact conversion to destination asset atomic units
- Immutable quote and calculation evidence
- Private idempotent `POST /api/v1/quotes` endpoint
- Stable validation and availability error codes
- Expiry, boundary, rounding, duplicate, and configuration-change tests

SELL quotes, price negotiation, inventory reservation, customer ledger changes,
withdrawal fees, discounts, promotions, tiers, tax calculation, and public quote
APIs are excluded.

## Request Meaning

`debitAmount` is the exact total fiat amount the customer authorizes Sendaza to
lock if the quote is accepted. It includes the trade principal and every SLE
purchase fee. It is a decimal string in the configured fiat precision.

```yaml
marketId: configured-market-uuid
side: BUY
debitAmount: '200000.00'
```

The client cannot select a reference snapshot, provider, route, spread, fee
policy, configuration version, rounding mode, or backing network.

## Calculation Contract

All request amounts become `bigint` atomic units before calculation. Rates use
`decimal.js` only at the reviewed conversion boundary. Let:

```text
D = requested total debit in fiat atomic units
F = configured fixed fee in fiat atomic units
P = configured percentage fee in basis points
S = configured spread in basis points
R = accepted reference rate, fiat units per one asset unit
```

Calculate in this order:

```text
percentage fee = ceil(D * P / 10,000)
total fee      = F + percentage fee
trade amount   = D - total fee
customer rate  = R * (10,000 + S) / 10,000
asset atomic   = floor((trade amount in fiat units / customer rate)
                       * 10^asset_decimals)
```

The requested principal is never silently rounded. A valid decimal string must
convert exactly to fiat atomic units. Percentage fees round upward to one fiat
atomic unit so the configured fee is not under-collected. Destination crypto
rounds downward so SLE never promises more inventory than the calculation can
support. The quote records both rules.

The display customer rate is normalized to a configured scale with half-even
rounding, but destination amount calculation uses the unrounded spread-adjusted
rate. The response therefore treats atomic amounts as authoritative.

`spreadAmount` is disclosed in quote fiat. It is the trade amount minus the
reference-rate fiat value of the delivered asset, rounded downward to fiat
atomic units. Any output-unit remainder is therefore visible rather than hidden.

## Limits and Eligibility

- The market, base asset, quote fiat, and backing asset-network must be enabled.
- `D` must be within the configured minimum and maximum total-debit limits.
- Fees must be non-negative and strictly less than `D`.
- The calculated destination atomic amount must be greater than zero.
- The latest accepted reference snapshot must belong to the enabled route for
  the market and remain valid at the quote transaction time.
- Quote expiry is the earlier of the policy quote TTL and reference snapshot
  expiry. SLE never extends source-rate validity.
- Sprint 4 does not check or reserve sellable inventory. Sprint 6 revalidates
  inventory when a purchase is created.

## Versioned Policy

Quote economics must not depend on mutable market columns. Sprint 4 introduces
immutable quote-policy versions containing market, spread basis points, fixed
fee atomic units, percentage-fee basis points, limits, quote TTL, rate display
scale, status, configuration version, actor, reason, and effective time.

Only one policy may be active for a market at a time. Changing economics creates
a new version. Existing quotes retain their original policy and configuration
references.

## Immutable Quote Evidence

Each quote stores:

```text
quote ID and side
market, base asset, quote fiat, and backing asset-network IDs
reference snapshot, route, route version, and reference rate
quote-policy version and configuration version
total debit, fixed fee, percentage fee, total fee, and trade amount
reference rate, customer rate, spread basis points, and spread amount
destination asset atomic amount
all decimal scales and rounding rules
created_at and expires_at
idempotency key, request hash, and correlation ID through existing infrastructure
```

Completed quote records and their economic components are immutable. Expiry is
derived from `expires_at`; no background job must mutate a quote to mark it
expired. Corrections create a new quote.

The database validates the selected snapshot and policy when it inserts the
quote. The existing idempotency layer then stores the response. A repeated
identical completed request returns the stored response. A
reused idempotency key with another request hash returns
`IDEMPOTENCY_KEY_REUSED`.

The quote insert and idempotency completion are currently separate database
transactions. A crash between them leaves the durable quote and an
`IN_PROGRESS` idempotency record; it cannot create a duplicate through that key,
but operations must reconcile it. Transactional completion or automated stale
record recovery is deferred before real-funds launch.

## Response Contract

Every monetary value is a decimal string:

```yaml
quoteId: quote-uuid
side: BUY
marketId: configured-market-uuid
debitAmount: '200000.00'
tradeAmount: '197000.00'
fixedFeeAmount: '1000.00'
percentageFeeAmount: '2000.00'
totalFeeAmount: '3000.00'
referenceRate: '6000000.0000'
customerRate: '6060000.0000'
spreadAmount: '1950.49'
destinationAmount: '0.032508250825082508'
expiresAt: 2026-09-01T12:00:15Z
configurationVersion: 5
```

The illustrative amounts are not an executable fixture. Contract tests will use
calculated values from reviewed test policies.

## Stable Failures

- `MARKET_DISABLED`
- `QUOTE_POLICY_UNAVAILABLE`
- `REFERENCE_RATE_UNAVAILABLE`
- `REFERENCE_RATE_EXPIRED`
- `ORDER_BELOW_MINIMUM`
- `ORDER_ABOVE_MAXIMUM`
- `FEES_EXCEED_DEBIT`
- `DESTINATION_AMOUNT_TOO_SMALL`
- `AMOUNT_INVALID`
- `AMOUNT_EXCESS_PRECISION`
- `IDEMPOTENCY_KEY_REUSED`

Provider details, internal policy IDs, database errors, and raw calculation
values do not enter public error messages or logs.

## Security, Observability, and Operations

- Sendaza Core is the only API principal; customer clients never call SLE.
- A request cannot choose provider, route, snapshot, policy, or rounding.
- Logs carry correlation and quote IDs but exclude customer PII and full bodies.
- Metrics cover quote latency, accepted and rejected counts, error code, policy
  age, reference-snapshot age, expiry, and amount bands without high-cardinality
  customer labels.
- Disabling a market or policy stops new quotes but never changes stored quotes.
- A circuit breaker may stop quote creation; it cannot rewrite quote economics.

## Required Tests

- Exact fixed-only, percentage-only, combined-fee, zero-fee, and zero-spread cases
- Minimum and maximum inclusive boundaries and one-atomic-unit failures
- Excess fiat precision and destination output rounding
- Very small and very large amounts without JavaScript `Number`
- Expired, missing, rejected, wrong-market, and concurrently expiring snapshots
- Configuration changes after quote creation
- Identical idempotency replay and conflicting key reuse
- Concurrent identical requests producing one stored quote
- PostgreSQL rollback of partial quote or idempotency state
- API schema, unknown-field, authentication, correlation, and stable-error tests

## Acceptance Criteria

- Every quote is reproducible from stored snapshot and policy evidence.
- Total debit equals trade amount plus fixed and percentage fees exactly.
- Monetary transport uses decimal strings and excess precision is rejected.
- No asset, fiat, network, fee, spread, or provider symbol is hardcoded.
- Quote creation does not reserve inventory or change Sendaza balances.
- A configuration change cannot change an existing quote.
- An expired or rejected reference snapshot cannot produce a quote.
- Repeated and concurrent requests cannot create duplicate financial records.

## Dependencies and Next Sprint

Sprint 3 supplies accepted reference snapshots. Sprint 4 supplies immutable quote
economics. Sprint 5 adds verified treasury evidence. Sprint 6 consumes an
unexpired quote only after Sendaza locks the exact debit, then atomically reserves
the quoted asset amount subject to current inventory.
