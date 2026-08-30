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
Vercel Functions Hobby
Neon PostgreSQL Free
Prisma
Alchemy Free on Sepolia
Coinbase public reference prices
Manual versioned NGN test cross-rate
Fireblocks Developer Sandbox through an MPC custody adapter
PostgreSQL transactional outbox
```

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
