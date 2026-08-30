# Sendaza Liquidity Engine Product Requirements

**Version:** 0.1 MVP  
**Status:** Design baseline  

## 1. Product Definition

SLE enables an eligible Sendaza customer to purchase configured crypto using an internal fiat balance and withdraw internally owned crypto to an external blockchain address.

## 2. Goals

- Provide deterministic, short-lived, executable purchase quotes.
- Prevent selling more crypto than the treasury can support.
- Execute external withdrawals with explicit finality states.
- Support additional assets, networks, fiat currencies, markets, and providers through configuration and adapters.
- Maintain a verifiable separation between treasury execution and the Sendaza customer ledger.

## 3. MVP Scope

### Included

- Executable quotes for configured crypto/fiat markets
- SLE-owned conversion routes, spreads, purchase fees, and immutable quote economics
- Purchase execution against prefunded asset-network treasury inventory
- Internal crypto ownership allocation
- Withdrawal of supported assets over configured networks
- Fee estimation and disclosure
- Purchase and withdrawal status lookup
- Signed webhooks to Sendaza
- Treasury balance, reservation, and liability snapshots
- Manual treasury funding and replenishment recording
- Automated reconciliation and liquidity alerts
- Administrative asset, network, market, limit, and provider configuration

### Excluded

- Customer crypto deposits
- Crypto-to-fiat selling
- Crypto-to-crypto swaps
- On-chain internal transfers
- Staking, lending, yield, leverage, or order books
- Automated treasury purchasing/rebalancing
- User-controlled keys or seed phrases
- Multi-provider best execution in the first production release
- External SLE client onboarding and partner-facing APIs

## 4. Actors

| Actor | Responsibility |
| --- | --- |
| Sendaza customer | Requests quote, accepts purchase, requests withdrawal |
| Sendaza Core | Authorizes users and owns customer balances/ledger |
| SLE | Prices, reserves inventory, orchestrates crypto execution |
| Custody provider | Protects keys, signs, and broadcasts transactions |
| Price provider | Supplies market data |
| Operations administrator | Funds treasury, resolves exceptions, configures limits |
| Compliance administrator | Reviews held or rejected withdrawals |

## 5. Functional Requirements

### Purchase

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| PUR-01 | Create a quote for an enabled market | Response contains decimal-string amounts, rate, fees, and expiry |
| PUR-02 | Validate market and order limits | Disabled or out-of-limit request is rejected before quoting |
| PUR-03 | Check sellable liquidity | Quote cannot exceed available inventory minus safety reserves |
| PUR-04 | Make quote immutable | Accepted quote economics cannot be recalculated silently |
| PUR-05 | Enforce expiry | Expired quote cannot create a purchase |
| PUR-06 | Enforce idempotency | Repeated key returns the original result without reallocating inventory |
| PUR-07 | Reserve inventory | Concurrent purchases cannot allocate the same treasury units |
| PUR-08 | Report terminal result | Sendaza receives a signed completed or failed event |
| PUR-09 | Avoid direct customer writes | SLE has no database permission to Sendaza ledger tables |

### External withdrawal

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| WDR-01 | Estimate fees | Estimate identifies amount, network fee, service fee, and total debit |
| WDR-02 | Validate address and network | Invalid or incompatible addresses are rejected before submission |
| WDR-03 | Enforce limits and policy | Asset, network, customer-tier, daily, and velocity rules are evaluated |
| WDR-04 | Require prior Sendaza lock | SLE rejects a request without a Sendaza lock reference |
| WDR-05 | Submit once | Provider receives at most one logical withdrawal per idempotency key |
| WDR-06 | Persist provider identity | Provider transaction ID and blockchain hash are retained |
| WDR-07 | Track finality | `BROADCASTED` is not treated as `CONFIRMED` |
| WDR-08 | Handle indeterminate outcomes | Uncertain broadcast remains held for reconciliation, never auto-refunded |
| WDR-09 | Notify Sendaza | Each state transition produces a signed, replayable event |

### Configuration and extensibility

| ID | Requirement |
| --- | --- |
| CFG-01 | Assets define symbol, type, display precision, accounting precision, and status |
| CFG-02 | Networks define native asset, address family, confirmations, fee strategy, and status |
| CFG-03 | Asset-network records map custody/provider identifiers and withdrawal controls |
| CFG-04 | Fiat currencies define ISO code, precision, and status |
| CFG-05 | Markets define base/quote asset, spreads, fees, limits, quote TTL, and status |
| CFG-06 | Provider routes select implementations without changing domain workflows |
| CFG-07 | Configuration changes are versioned and audited |
| CFG-08 | One asset may be enabled on multiple networks with separate contracts, precision, fees, limits, custody routes, and treasury balances |
| CFG-09 | Inventory on one network cannot satisfy a withdrawal on another network without a confirmed and reconciled rebalance |

## 6. Purchase Journey

```text
Customer selects an enabled crypto/fiat market and enters a fiat amount
  -> Sendaza validates eligibility
  -> Sendaza requests SLE quote
  -> Customer sees exact debit, fee, rate, crypto amount, expiry
  -> Customer confirms
  -> Sendaza locks fiat
  -> SLE reserves the configured asset-network inventory and accepts purchase
  -> Sendaza atomically settles fiat and crypto ledger entries
  -> Sendaza acknowledges settlement to SLE
  -> Both systems mark purchase completed
```

If SLE rejects before accepting, Sendaza releases the fiat lock. If the
acceptance outcome is uncertain, the lock remains until status lookup or
reconciliation resolves it.

## 7. Withdrawal Journey

```text
Customer enters amount, network, and address
  -> Sendaza checks eligibility and balance
  -> SLE estimates fees and validates destination
  -> Customer confirms exact total debit
  -> Sendaza locks crypto
  -> SLE applies withdrawal policy
  -> Custody provider signs and broadcasts
  -> SLE reports transaction hash
  -> SLE verifies required confirmations
  -> Sendaza finalizes locked-balance deduction
```

## 8. Non-Functional Requirements

| Category | MVP target |
| --- | --- |
| Quote latency | p95 below 750 ms excluding upstream outage |
| Mutation availability | 99.9% monthly after production launch |
| Quote TTL | Configurable, default 15 seconds |
| Amount transport | Decimal strings only |
| Idempotency retention | Minimum 7 years for financial operations |
| Audit retention | Per approved regulatory policy, minimum 7 years proposed |
| Webhook delivery | At-least-once, signed, replayable |
| Recovery point | No loss of committed financial state |
| Recovery time | 60 minutes for MVP |
| Observability | Correlation ID across Sendaza, SLE, provider, and chain transaction |

## 9. Success Measures

- No duplicate purchase allocations or withdrawal broadcasts.
- Daily treasury-to-liability reconciliation has zero unexplained variance.
- At least 99% of valid quotes are generated within target latency.
- At least 95% of withdrawals reach broadcast or a clear rejection within two minutes, excluding manual review.
- Every completed user balance change can be traced to an SLE order and immutable Sendaza ledger transaction.

## 10. Open Product Decisions

- Whether spread, explicit purchase fee, or both are customer-visible
- Whether network fee is exact, buffered estimate, or platform-subsidized
- Customer cancellation policy before withdrawal broadcast
- Required confirmation count by network and transaction value
- Manual review thresholds by KYC tier
- Who bears fee-estimate variance
