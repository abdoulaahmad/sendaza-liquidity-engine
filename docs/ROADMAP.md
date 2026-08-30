# Sendaza Liquidity Engine Implementation Roadmap

Delivery follows [METHODOLOGY.md](./METHODOLOGY.md): module specifications,
two-week vertical iterations, definitions of ready/done, and mandatory financial
safety gates. Work is delivered through short-lived GitHub branches, meaningful
commits, reviewed pull requests, and protected default-branch merges. Completing
sprint tasks does not by itself approve a release.

The concrete 24-week execution sequence is defined in
[SPRINT_PLAN.md](./SPRINT_PLAN.md).

## Delivery Principle

Build one complete configured crypto/fiat path before activating additional
markets. The implementation is configuration-driven and must not hardcode ETH,
NGN, or Ethereum. Sendaza is the only MVP service client.

## Phase 0: Decisions and Compliance Gate

Deliverables:

- Approve the documents in this package.
- Obtain legal classification and licensing route.
- Select custody, price, RPC/indexer, and address-screening providers.
- Decide fee ownership, withdrawal confirmation policy, and limits.
- Approve crypto precision migration for Sendaza Core.

Exit criteria:

- No unresolved decision changes ledger or custody boundaries.
- Provider sandbox access is available.
- Compliance authorizes sandbox development.

## Phase 1: Foundation

Deliverables:

- Standalone NestJS service and PostgreSQL database
- Asset, network, fiat, market, and provider registries
- Atomic-unit amount library and validation
- Service authentication and idempotency middleware
- Audit log and transactional outbox
- Provider interfaces with deterministic sandbox implementations

Tests:

- Precision and conversion tests
- Idempotency concurrency tests
- Configuration versioning tests
- Authentication and replay tests

## Phase 2: Crypto Purchase

Deliverables:

- Configurable market-data and fiat cross-rate adapters
- Versioned pricing routes, spreads, and purchase fees
- Quote calculation and expiry
- Treasury snapshot and sellable-inventory calculation
- Purchase reservation state machine
- Sendaza lock/settlement handshake
- Purchase webhook events and replay

Tests:

- Concurrent purchase oversell attempt
- Expired quote acceptance
- Duplicate purchase submission
- SLE success plus Sendaza rollback/timeout
- Stale or deviating price provider
- Liquidity threshold circuit breaker

## Phase 3: External Withdrawal

Deliverables:

- Network-specific address validators
- Cached asset-network fee estimators
- Withdrawal policy engine
- Fireblocks MPC custody adapter
- Automated low-risk withdrawal policy with manual-review thresholds
- Submission, broadcast, replacement, and confirmation tracking
- Withdrawal webhook lifecycle
- Manual review and cancellation-before-submission controls

Tests:

- Invalid and wrong-network destinations
- Duplicate provider submission
- Automatic approval within custody-policy limits
- Manual review above custody-policy limits
- Timeout before and after provider acceptance
- Dropped or replaced blockchain transaction
- Webhook loss, duplication, reordering, and replay
- Insufficient treasury gas

## Phase 4: Sendaza Integration

Deliverables:

- Crypto-capable Sendaza ledger precision
- Customer fiat and crypto lock journals
- SLE client module in Sendaza Core
- Sendaza inbound event store and handler
- Mobile purchase and withdrawal flows
- Admin operational views

Tests:

- Full purchase ledger conservation
- Full confirmed withdrawal ledger conservation
- Failure release and ambiguous hold behavior
- Authorization, KYC, limits, and transaction PIN enforcement
- Cross-service recovery after either service restarts

## Phase 5: Treasury and Reconciliation

Deliverables:

- Manual funding-intent workflow
- Chain/custody balance snapshots
- Signed Sendaza liability reports
- Cutoff-aligned reconciliation
- Liquidity warnings and critical circuit breaker
- Daily solvency report and audit export

Tests:

- Holdings/liability timestamp mismatch
- Unexplained shortfall
- Provider balance disagreement
- Pending outgoing transaction treatment
- Database restoration and report reproduction

## Phase 6: Hardening and Pilot

Deliverables:

- Threat model and independent security review
- Penetration test and remediation
- Load, soak, and fault-injection testing
- Incident and disaster-recovery exercises
- Production custody policy and approval ceremony
- Limited customer pilot with capped treasury exposure

Launch gates:

- Zero unresolved critical/high security findings
- Zero unexplained reconciliation variance during pilot window
- Legal/compliance approval
- Operations demonstrates withdrawal recovery and emergency suspension
- Finance signs treasury and solvency controls

## Deferred Backlog

Only consider after the first configured market pilot:

- Additional crypto assets and networks
- Additional fiat currencies and markets
- Multi-provider routing
- Automated treasury replenishment
- Customer crypto deposits
- Crypto-to-fiat selling
- Crypto-to-crypto conversion
- External SLE client onboarding and per-client liquidity pools

## Suggested Repository Layout

```text
apps/sendaza_liquidity_engine/
  prisma/
  src/
    assets/
    markets/
    quotes/
    purchases/
    withdrawals/
    treasury/
    reconciliation/
    providers/
      pricing/
      custody/
      networks/
    webhooks/
    audit/
    common/
packages/shared-contracts/
  schemas/sle/
```

## Definition of MVP Complete

The MVP is complete only when an eligible sandbox customer can buy a configured
crypto asset using a locked fiat balance, see an accurately settled internal
crypto balance, withdraw part of it over an enabled network, and have every state
independently reconciled across Sendaza, SLE, custody records, and the blockchain.
