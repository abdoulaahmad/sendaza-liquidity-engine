# SLE MVP Sprint Plan

**Cadence:** 12 two-week sprints  
**Duration:** Approximately 24 weeks  
**Deployment:** Local Docker, then Railway sandbox  
**Custody:** Fireblocks Developer Sandbox  
**Client:** Sendaza Core only

## Operating Rules

Every sprint has a GitHub milestone, a vertical outcome, stories meeting the
Definition of Ready, focused pull requests, an integrated demonstration, and an
explicit gate. Implementation, tests, telemetry, and documentation ship together.

Each sprint targets at least 30 meaningful GitHub contributions across scoped
commits, issues, pull requests, reviews, and documented decisions. Contribution
volume does not replace the sprint gate, and empty commits or artificial file
churn are prohibited.

## Sprint 0: Repository and Delivery Foundation

**Outcome:** A protected, reproducible repository that builds, tests, and deploys
a minimal API and worker.

**Work:**

- Initialize the standalone GitHub repository and protected `main` branch.
- Configure author email, pull-request checks, labels, and issue templates.
- Create the NestJS workspace with API and worker applications.
- Add domain, database, contracts, configuration, and testing packages.
- Add Docker, local PostgreSQL, Prisma, and environment validation.
- Add GitHub Actions for type checks, linting, tests, build, and secret scanning.
- Create Railway API, worker, and PostgreSQL services.
- Add API health checks and a persisted worker heartbeat.

**Demo:** Merge a PR into `main`; CI passes and Railway deploys both processes.

**Gate:** A clean checkout starts locally, invalid configuration fails closed,
and no populated secret exists in the repository.

## Sprint 1: Exact Amounts and Registries

**Outcome:** SLE represents configured assets, fiat, networks, asset-network
routes, and markets without floating-point arithmetic.

**Work:**

- Specify the Core Platform module.
- Implement atomic-unit conversion using `bigint` and `decimal.js`.
- Add asset, fiat, network, asset-network, and market schemas.
- Add configuration versions, audit history, and enable/disable states.
- Seed an illustrative market and two routes for one multi-network asset.
- Add discovery endpoints and precision tests.

**Demo:** Retrieve configured markets and round-trip exact values across different
asset precisions and USDT network routes.

**Gate:** Excess precision is rejected, no financial calculation uses JavaScript
`Number`, and asset-network uniqueness is enforced.

## Sprint 2: Authentication, Idempotency, and Outbox

**Outcome:** Sendaza calls protected endpoints safely and committed events survive
process restarts.

**Work:**

- Implement Sendaza HMAC authentication and credential rotation.
- Add timestamp, nonce, and body-hash replay protection.
- Add correlation IDs and structured audit logs.
- Implement request-hash idempotency and stored response replay.
- Implement transactional outbox leasing, retry, and quarantine.
- Add forged signature, replay, conflict, concurrency, and restart tests.

**Demo:** Replay identical and conflicting requests, restart the worker after a
commit, and show exactly one durable financial effect.

**Gate:** Unauthenticated requests cannot reach domain services, one idempotency
key cannot produce two effects, and committed events cannot be lost.

## Sprint 3: Market Data and Conversion Routes

**Status:** Delivered on 1 September 2026. Production pricing configuration
remains inactive pending reviewed sandbox activation.

**Outcome:** SLE produces auditable reference rates through configured direct and
multi-leg pricing routes.

**Work:**

- Specify the Market Data module and provider interfaces.
- Add deterministic fake and sandbox market-data adapters.
- Implement direct and multi-leg route evaluation.
- Persist source rates, provider timestamps, and stablecoin references.
- Add stale-rate, deviation, sequence-gap, and stablecoin-depeg guards.
- Schedule market refreshes in the worker.

**Demo:** Evaluate illustrative direct and cross-rate markets, then suspend
pricing when a route becomes stale or unsafe.

**Gate:** Every rate is reproducible from stored observations, unsafe legs stop
quoting, and no asset or fiat branch is hardcoded.

## Sprint 4: Executable Quote Engine

**Status:** Complete on 2 September 2026. Quote economics, persistence,
private API, database guards, tests, and handover report are delivered. Runtime
policy activation remains an explicit operational action and was not performed.

**Outcome:** Sendaza receives immutable purchase quotes containing SLE-owned
spreads, fees, exact amounts, and expiry.

**Work:**

- Specify the Quote Engine module.
- Implement order limits, spreads, and fixed/percentage purchase fees.
- Calculate exact customer rates, debit amounts, and crypto amounts.
- Persist route evidence, configuration version, and quote expiry.
- Add quote endpoints and stable error contracts.
- Test expiry, boundaries, rounding, duplicates, and configuration changes.

**Demo:** Create a quote, disclose every component, reject it after expiry, and
reproduce its calculation from stored evidence.

**Gate:** Quote economics cannot be silently recalculated and all monetary
transport uses decimal strings.

## Sprint 5: Fireblocks Treasury Synchronization

**Status:** Complete on 2 September 2026. Network-scoped treasury state,
Fireblocks and fake adapters, independent EVM verification, leased synchronization,
funding intents, database guards, and tests are delivered. Live Fireblocks
sandbox funding evidence remains an external activation task because no sandbox
credentials or funded vault are available in the repository environment.

**Outcome:** SLE observes and verifies controlled Fireblocks wallets and treasury
inventory by asset-network.

**Work:**

- Specify Treasury and Custody modules.
- Implement fake and Fireblocks `CustodyProvider` adapters.
- Register vault and asset-wallet identifiers.
- Synchronize provider balances and public addresses.
- Verify important balances through network adapters.
- Model gas reserves, safety buffers, stale evidence, and funding intents.
- Test provider disagreement and credential failure.

**Demo:** Fund a Fireblocks testnet wallet and show controlled, unallocated,
reserved, and unavailable inventory.

**Gate:** SLE never stores treasury private keys, inventory is network-scoped,
and stale/conflicting evidence prevents unsafe allocation.

## Sprint 6: Purchase Reservation and Settlement

**Outcome:** An accepted quote reserves inventory exactly once and converges with
Sendaza ledger settlement.

**Work:**

- Implement sellable-inventory calculation and purchase states.
- Add atomic reservations with database locking.
- Create purchases from unexpired quotes.
- Add settlement acknowledgement, rollback, timeout, and reconciliation states.
- Emit signed purchase lifecycle events.
- Test oversell races, duplicates, crashes, and ambiguous settlement.

**Sendaza dependency:** Exact crypto ledger precision, journal-backed fiat locks,
purchase intents, and settlement references.

**Demo:** Run concurrent purchases against limited inventory without overselling.

**Gate:** Ambiguous settlement never causes blind release and completed purchases
are immutable.

## Sprint 7: Cached Network Fee Engine

**Outcome:** Sendaza receives fast fee quotes from fresh asset-network snapshots.

**Work:**

- Specify the Network Fee module.
- Add fee-adapter interfaces and deterministic fakes.
- Collect provider and independent RPC observations where supported.
- Persist snapshots by asset-network and transfer type.
- Add freshness states, configurable refresh intervals, and fee buffers.
- Convert native fees into the configured customer charge asset.
- Store estimated, buffered, charged, and actual fee components.

**Demo:** Quote one asset over two networks using different native fee assets,
then reject an expired snapshot.

**Gate:** An asset symbol alone cannot select a fee route, stale snapshots cannot
quote, and confirmed customer debit is never silently increased.

## Sprint 8: Withdrawal Policy and Fireblocks Submission

**Outcome:** An authorized withdrawal reaches Fireblocks at most once and remains
safely locked when submission is uncertain.

**Work:**

- Implement withdrawal state machine and destination validation.
- Add amount, velocity, treasury, gas, and policy checks.
- Implement automatic low-risk and manual-review paths.
- Persist withdrawals before custody submission.
- Use the SLE withdrawal ID as provider idempotency reference.
- Add Fireblocks creation, lookup, and cancellation-before-submission.
- Test timeouts before/after acceptance and duplicate submission.

**Sendaza dependency:** Journal-backed crypto/fee locks, transaction PIN evidence,
and durable lock references.

**Demo:** Automatically submit one withdrawal, hold another for review, and
demonstrate safe `SUBMISSION_UNKNOWN`.

**Gate:** Retries cannot create another transfer and only proven failure before
submission permits immediate release.

## Sprint 9: Webhooks and Blockchain Finality

**Outcome:** SLE tracks withdrawal broadcast, replacement, and confirmations and
delivers signed lifecycle events to Sendaza.

**Work:**

- Verify Fireblocks signatures and replay IDs.
- Store provider events before processing.
- Poll Fireblocks as recovery for missing webhooks.
- Implement network transaction and confirmation adapters.
- Retain original and replacement hashes.
- Implement finality and reconciliation-required transitions.
- Test duplicate, forged, delayed, reordered, and missing webhooks.

**Demo:** Complete a testnet withdrawal with custody and independent blockchain
evidence through to Sendaza delivery.

**Gate:** Broadcast is never confirmation, webhook loss cannot lose state, and
final settlement requires independent finality evidence.

## Sprint 10: Sendaza End-to-End Integration

**Outcome:** A sandbox customer purchases and withdraws a configured asset through
Sendaza with exact and recoverable cross-system state.

**Work:**

- Complete the Sendaza SLE client.
- Store signed inbound events before acknowledgement.
- Complete purchase and withdrawal journals.
- Add customer transaction status mapping.
- Generate signed liability snapshots.
- Wire the sandbox mobile/admin demonstration flows.
- Add cross-service contract, failure, and restart tests.

**Demo:** Purchase a configured crypto asset and withdraw part of it through
Sendaza, SLE, Fireblocks, and the enabled test network.

**Gate:** Every balance change maps to immutable records and either service can
restart at every external transition and converge.

## Sprint 11: Reconciliation, Hardening, and Pilot

**Outcome:** The full sandbox runs under reconciliation, observability, recovery,
and security controls suitable for stakeholder acceptance.

**Work:**

- Reconcile holdings, liabilities, reservations, pending withdrawals, and fees.
- Persist variance severity, ownership, and resolution evidence.
- Activate liquidity and shortfall circuit breakers.
- Run load, concurrency, and fault-injection tests.
- Exercise backup, restore, replay, provider outage, and credential revocation.
- Complete threat model, security review, and stakeholder evidence pack.

**Demo:** Inject a mismatch and provider outage, show safe suspension and
recovery, then complete a clean purchase and withdrawal.

**Gate:** No unexplained variance or unresolved critical/high finding remains,
and recovery exercises pass.

## GitHub Milestones

```text
S00 Repository Foundation
S01 Amounts and Registries
S02 Authentication and Reliability
S03 Market Data
S04 Executable Quotes
S05 Fireblocks Treasury
S06 Purchase Settlement
S07 Network Fees
S08 Withdrawal Submission
S09 Finality and Webhooks
S10 Sendaza Integration
S11 Reconciliation and Pilot
```

Recommended labels:

```text
area:platform       area:pricing       area:purchase
area:treasury       area:custody       area:withdrawal
area:sendaza        area:reconciliation
type:feature        type:defect        type:test
type:docs           type:security      type:operations
risk:financial      risk:custody       risk:integration
status:blocked      status:needs-decision
```

## Sprint Reporting

Record accepted and deferred stories, demo evidence, tests and failure scenarios,
open risks and decisions, release-gate status, and meaningful GitHub activity.
The plan may be reforecast after retrospectives, but a failed financial gate is
never bypassed to preserve the calendar.
