# Network Fee Module

## Purpose and Boundary

The Network Fee module gives Sendaza fast, bounded withdrawal fee quotes from
recent cached evidence. It estimates only external blockchain withdrawal cost.
Purchase fees and spreads remain owned by the Quote Engine.

Every route is keyed by `asset_network_id` and transfer type. An asset symbol
alone is never enough: USDT on Ethereum and USDT on Tron have different native
fee assets, estimators, policies, snapshots, and treasury gas requirements.

## Configuration

A versioned network-fee policy selects, server-side:

- asset-network and transfer type;
- native fee asset and customer charge asset;
- required estimator routes and minimum independent observations;
- observation and snapshot TTLs;
- maximum provider/RPC deviation;
- percentage and fixed native-fee buffers;
- fixed and percentage service fees;
- quote TTL and execution tolerance.

Sendaza cannot choose an estimator, conversion route, policy version, custody
wallet, fee level, buffer, or rounding mode.

## Refresh Flow

```text
due asset-network + transfer type
              |
              v
fee adapter estimate ---- independent RPC estimate
              |                    |
              +---------+----------+
                        v
             freshness + deviation checks
                   /             \
               reject          accept
                 |                |
        retry / circuit state   immutable snapshot
                                  |
                    native cost + configured buffer
                                  |
                 fresh conversion evidence if needed
                                  |
                    cached charge-asset network fee
```

Adapters return integer native atomic units and evidence timestamps. Vendor SDKs
remain inside adapters. Deterministic fakes are used for unit and contract tests.

## Snapshot Economics

```text
estimated_native_fee = accepted estimator result
percentage_buffer = ceil(estimated_native_fee * buffer_bps / 10,000)
buffered_native_fee = estimated_native_fee + percentage_buffer + fixed_buffer
charged_network_fee = ceil(buffered_native_fee converted into charge asset)
```

If the charge asset is the native fee asset, conversion is exactly one-to-one.
Otherwise the snapshot records the immutable conversion evidence and rate. No
floating-point JavaScript arithmetic is permitted.

## Withdrawal Fee Quote

The request identifies an enabled asset-network, transfer type, principal, and
destination. The quote service loads the latest accepted snapshot and active
policy, rejects missing or expired evidence, validates exact asset precision, and
stores an immutable quote containing:

- principal and recipient amount;
- estimated and buffered native fee;
- charged network fee in the customer charge asset;
- service fee and total debit;
- asset-network, native fee asset, charge asset, transfer type;
- policy, fee snapshot, conversion evidence, rounding mode, and expiry.

The MVP uses add-on fees: `recipient_amount = principal`, and
`total_debit = principal + charged_network_fee + service_fee` when all three are
denominated in the withdrawn asset. Cross-asset customer debits are rejected in
the MVP rather than presenting an ambiguous total.

## Safety and Failure Rules

- Missing, stale, rejected, or insufficiently independent evidence cannot quote.
- Provider and RPC disagreement beyond policy tolerance cannot publish.
- A cached snapshot is immutable and cannot be refreshed in place.
- Quotes never fall back to a hardcoded fee.
- Excess principal precision is rejected, never rounded.
- Fee buffers round upward; recipient amounts are never reduced silently.
- Execution may reject or enter review when actual cost exceeds tolerance, but
  cannot increase the locked customer debit.
- Estimated, buffered, charged, and later actual costs remain separate fields.
- Financial state and its outbox event commit in one PostgreSQL transaction.

## Delivered in Sprint 7

- `PrismaNetworkFeeRepository` and `PrismaNetworkFeeRefreshJobRepository`
  persist observations, immutable snapshots, and leased refresh jobs with
  `FOR UPDATE SKIP LOCKED` claiming.
- `NetworkFeeRefreshWorker` polls due asset-network/transfer-type jobs, calls
  the configured fee estimator, and publishes an immutable snapshot through
  `NetworkFeeRefreshBatchService`.
- `POST /withdrawal-fee-quotes` consumes the latest fresh accepted snapshot and
  active policy, calculates the exact withdrawal fee quote, and returns
  decimal-string amounts behind idempotency and audit interceptors.

## Deferred Work

Sprint 7 does not submit Fireblocks transfers or record actual mined fees. Sprint
8 consumes the immutable fee quote for withdrawal policy and submission. Later
finality and reconciliation sprints attach actual on-chain fee evidence and
measure estimate variance.
