# Treasury Module

## Purpose and Boundary

The Treasury module turns custody-provider and independent blockchain evidence
into network-scoped inventory that later purchase and withdrawal modules may
use. It does not reserve inventory, move funds, create customer liabilities, or
write Sendaza balances.

Every wallet belongs to one `asset_network_id`. USDT on Ethereum, Tron, Solana,
or Polygon therefore has independent wallets, snapshots, reserves, freshness,
and sellable inventory. Cross-network backing is forbidden until an explicit
rebalance is confirmed and reconciled.

## Inventory Meaning

Provider evidence contains total controlled, available, pending, frozen, and
locked amounts as decimal strings. It is converted exactly to atomic `bigint`
values using the configured asset-network precision.

```text
controlled   = provider total
unallocated  = provider available
reserved     = active SLE purchase reservations (zero until Sprint 6)
unavailable  = controlled - provider available
sellable     = max(provider available - reserved - safety buffer - gas reserve, 0)
```

`sellable` is forced to zero when evidence is stale or an independently checked
chain balance disagrees. A consumer must also compare `evidence_expires_at` with
its transaction time; a stored current row is not proof of current freshness.

Gas reserves are configured only on the native-asset wallet that pays the
network fee. Token inventories have separate asset-network rows and must not
subtract another asset's units.

## Data and Transactions

- `treasury_wallets` stores provider vault/asset identifiers, public addresses,
  asset-network ownership, verification policy, and buffers.
- `treasury_snapshots` stores immutable provider, chain, reserve, freshness, and
  calculated inventory evidence.
- `treasury_inventory_state` points to the latest snapshot for an asset-network.
- `treasury_sync_jobs` provides bounded, leased, crash-retryable work.
- `treasury_funding_intents` records planned manual funding and forward-only
  observation/confirmation states.

Snapshot insertion and current-state publication commit in one PostgreSQL
transaction. PostgreSQL recomputes unavailable and sellable values, validates
wallet policy, and rejects snapshot update or deletion. Funding intent identity,
amount, actor, and reason cannot be rewritten.

## Synchronization Flow

```text
claim due wallet job with SKIP LOCKED
             |
             v
fetch custody balance + registered addresses
             |
             v
verify configured public address and exact precision
             |
             v
important wallet -> independently read chain balance
             |
             v
MATCHED / UNVERIFIED / MISMATCH / STALE
             |
             v
immutable snapshot + current inventory in one transaction
```

A successful job schedules the normal refresh interval. Credential, provider,
chain, address, and evidence errors store a safe error code and schedule an
earlier retry. Expired leases may be reclaimed after a worker crash.

## Failure Rules

- Provider precision beyond asset-network precision is rejected.
- Provider available balance cannot exceed controlled balance.
- A configured address must appear in the provider wallet response, including a
  required tag or memo.
- Important wallets cannot publish unverified sellable inventory.
- Provider/chain mismatch and stale evidence publish zero sellable inventory.
- Logs and persisted error fields contain stable codes, not credentials or raw
  provider error bodies.
- Activating a wallet is a reviewed configuration action; the client cannot
  select a wallet or provider.

## Sprint 6 Dependency

Purchase reservation must lock the asset-network inventory row, reject expired
or unsafe evidence, and atomically add its reservation. It may never use a quote
or holding from another network.

