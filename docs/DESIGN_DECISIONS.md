# SLE Design Decisions

This file records decisions made after the initial SLE document baseline. Where earlier documents use Sendaza-specific integration language, these decisions take precedence.

## ADR-001: SLE Is Sendaza-Only for the MVP

**Decision:** Accepted

The MVP serves only Sendaza Core through a private authenticated service API.
External client onboarding, tenant administration, and partner-facing APIs are
deferred until the Sendaza integration is proven.

Consequences:

- The only configured service client is Sendaza.
- Customer frontends never call SLE directly.
- SLE never embeds Sendaza ledger or user-management logic.
- Sendaza owns customer identity and ledger state; SLE owns quotes, pricing economics, treasury, custody, and withdrawals.
- Asset, fiat, network, market, and provider models remain generic for product extensibility.
- Multi-client isolation and pool assignment remain a deferred architecture.

Deferred platform details: [MULTI_CLIENT_DESIGN.md](./MULTI_CLIENT_DESIGN.md)

## ADR-002: Free-First Testnet MVP

**Decision:** Accepted

The MVP uses free-tier services and Ethereum Sepolia to validate behavior without real customer funds.

Canonical stack:

```text
NestJS + TypeScript
Railway API and worker services
Railway PostgreSQL
Prisma
Alchemy Free on Sepolia
Coinbase public reference prices
Manual versioned NGN test cross-rate
Fireblocks Developer Sandbox through an MPC custody adapter
PostgreSQL transactional outbox
```

Railway replaced the earlier Vercel Functions and Neon proposal because SLE
needs an always-running worker and one PostgreSQL operational boundary for the
sandbox. The current Railway project contains the database service; API and
worker deployment remain a later sandbox activation task.

This configuration is not approved for mainnet or customer funds.

Canonical details: [TECH_STACK_MVP.md](./TECH_STACK_MVP.md)

## ADR-003: Integration Terminology

**Decision:** Accepted

Domain records use stable integration identifiers even though Sendaza is the only
MVP caller:

| Earlier term | Canonical term |
| --- | --- |
| `sendaza_customer_id` | `customer_reference` |
| `sendaza_lock_reference` | `client_lock_reference` |
| `sendaza_transaction_reference` | `client_settlement_reference` |
| Sendaza liability snapshot | Client liability snapshot |
| Sendaza webhook endpoint | Registered client webhook endpoint |

SLE authenticates Sendaza from its service credential. Request bodies cannot
select another tenant, custody provider, treasury pool, or pricing policy.

## ADR-004: Sendaza Sandbox Treasury Pool

**Decision:** Accepted

The MVP uses one Sendaza sandbox treasury pool. A future migration may introduce
`pool_id` and client assignments when external-client support is approved; the
MVP does not implement multi-client pool administration.

## ADR-005: Production Upgrade Is a Launch Gate

**Decision:** Accepted

Before mainnet or real funds, replace free batch execution, the developer custody workspace, single-source pricing, and free database guarantees with approved always-running workers, a contracted production MPC workspace, redundant pricing, managed backups/PITR, screening, and retained observability.

## ADR-006: MPC-Only Blockchain Signing

**Decision:** Accepted

All blockchain signing is delegated to an MPC custody provider. SLE never stores,
loads, reconstructs, or accepts a treasury private key or seed phrase. The first
implementation uses Fireblocks Developer Sandbox with Sepolia assets.

SLE stores only encrypted provider API credentials or credential references,
provider wallet IDs, public addresses, provider transfer IDs, and blockchain
transaction hashes. Custody remains behind the generic `CustodyProvider`
interface so a different approved MPC provider can be selected later.

Low-risk withdrawals may be automatically approved when they satisfy both the
SLE policy engine and independently configured custody-provider policies.
Transactions above configured thresholds or with elevated risk require manual
review or approval. Clients cannot select the custody provider or approval mode.

## ADR-007: Asset and Network Are Separate Dimensions

**Decision:** Accepted

An asset such as USDT is defined once and may have multiple `asset_network`
mappings such as Ethereum ERC-20, Tron TRC-20, Solana SPL, and Polygon ERC-20.
Each mapping has its own token identifier, network precision, custody route,
treasury wallets, limits, fee policy, fee snapshots, and availability.

Customer liabilities may be represented by asset, but on-chain inventory and
withdrawal execution are scoped by `asset_network_id`. SLE cannot use holdings
on one network to approve a withdrawal on another network unless a separate
rebalancing workflow has completed and reconciled the movement.

## ADR-008: Pricing Uses Versioned Instruments, Routes, And Evidence

**Decision:** Accepted

Pricing is configuration-driven through normalized asset/fiat instruments,
provider pair mappings, and ordered versioned conversion-route legs. Every
reference-rate snapshot links to the exact immutable observations used.

Provider values enter as decimal strings. Route arithmetic uses `decimal.js` and
normalizes once at the configured output scale with recorded `ROUND_HALF_EVEN`.
Stablecoin status is explicit route policy backed by a fresh reference pair; SLE
does not infer stability from an asset symbol.

The free MVP may demonstrate Coinbase public reference prices plus a reviewed,
versioned manual fiat cross-rate. This single-source design is test-only.
Independent redundant production pricing remains a mainnet launch gate.

## ADR-009: Purchase Quotes Use Total Debit and Versioned Economics

**Decision:** Accepted

A BUY quote request supplies the exact total fiat debit. SLE deducts the
versioned fixed and percentage purchase fees, converts the remaining trade
amount using the spread-adjusted reference rate, and returns the exact crypto
destination amount.

Percentage fees round upward to fiat atomic units. Destination crypto rounds
downward to asset atomic units. The customer principal is never silently
rounded. Quote amounts, rates, fee components, spread, scales, rounding rules,
reference snapshot, policy version, configuration version, and expiry are
stored as immutable evidence.

Order minimum and maximum apply to total debit. Quote expiry cannot exceed the
source reference snapshot expiry. Quote creation does not reserve inventory;
Sprint 6 performs reservation after Sendaza locks the exact quoted debit.

Canonical details: [modules/quote-engine/MODULE.md](./modules/quote-engine/MODULE.md)

## ADR-010: Treasury Availability Requires Fresh Network-Scoped Evidence

**Decision:** Accepted

Each enabled treasury wallet belongs to exactly one asset-network and one
server-configured custody provider route. SLE calculates sellable inventory from
provider available balance minus active reservations, the asset-network safety
buffer, and any same-asset native gas reserve.

Important wallets require an independent chain balance check. Stale evidence or
provider/chain disagreement publishes zero sellable inventory. Provider-only
evidence remains explicitly `UNVERIFIED` and is permitted only when wallet policy
does not require independent verification.

Treasury snapshots are immutable. The latest inventory projection and its source
snapshot commit together, and every consumer must recheck evidence expiry.
Funding is represented by audited forward-only intents; Sprint 5 does not move
funds automatically.

Fireblocks remains behind the domain-owned `CustodyProvider` interface. Its RSA
API authentication key is a deployment secret, not treasury signing material.
No treasury private key or seed phrase enters SLE.

Canonical details: [modules/treasury/MODULE.md](./modules/treasury/MODULE.md) and
[modules/custody/MODULE.md](./modules/custody/MODULE.md).

## ADR-011: Purchase Settlement Holds Ambiguous Inventory

**Decision:** Accepted on 2 September 2026

A purchase consumes one unexpired immutable quote and reserves its exact crypto
destination amount from fresh, independently matched inventory on the quote's
asset-network. Quote, inventory, purchase, reservation, transition, and outbox
changes use one PostgreSQL transaction with row locking and database uniqueness.

On Sendaza `COMMITTED`, reserved inventory becomes allocated customer-liability
backing and remains unavailable for another sale. On a proven Sendaza
`ROLLED_BACK`, the reservation is released. Missing or late acknowledgement
moves the purchase to `RECONCILIATION_REQUIRED` without releasing inventory.

Terminal purchases and settlement evidence are immutable. Corrections use linked
compensating records. SLE never writes Sendaza balances or claims cross-service
ACID atomicity.

Canonical details: [modules/purchase-engine/MODULE.md](./modules/purchase-engine/MODULE.md).

## ADR-012: Withdrawal Fees Use Cached Network-Scoped Evidence

**Decision:** Proposed on 3 September 2026

Network fees are estimated and cached separately for every configured
asset-network and transfer type. A refresh combines a fee-provider estimate with
an independent RPC estimate where the network supports both. A snapshot is
publishable only when the required observations are fresh and within the
configured deviation tolerance.

The snapshot stores the estimated native fee, the versioned safety buffer, the
buffered native fee, and the evidence used. When the withdrawn asset is not the
network's native fee asset, SLE converts the buffered native fee into the
configured customer charge asset using a fresh immutable conversion snapshot.
All rounding favors treasury safety and is recorded explicitly.

A withdrawal fee quote consumes the latest fresh accepted snapshot and freezes
principal, estimated fee, buffer, charged network fee, service fee, total debit,
recipient amount, policy version, conversion evidence, and expiry. Execution may
reject or require review when current cost exceeds tolerance, but it never
silently increases the customer-approved debit.

Canonical details: [modules/network-fees/MODULE.md](./modules/network-fees/MODULE.md).
