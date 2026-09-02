# Sendaza Liquidity Engine Architecture

## 1. System Boundary

SLE is a separately deployable private service. It has its own database and credentials. It does not share Prisma models or direct database access with Sendaza Core.

```text
                           +---------------------+
                           | Sendaza Mobile App  |
                           +----------+----------+
                                      |
                                      v
+----------------------+    +---------+----------+
| Sendaza Admin        +--->+ Sendaza Core       |
+----------------------+    | - users and KYC    |
                            | - customer ledger  |
                            | - balance locks    |
                            +---------+----------+
                                      |
                         mTLS/service JWT + HMAC events
                                      |
                            +---------v----------+
                            | SLE                |
                            | - quotes           |
                            | - purchases        |
                            | - withdrawals      |
                            | - treasury         |
                            | - reconciliation   |
                            +---+-------------+---+
                                |             |
                         +------v----+   +----v----------------+
                         | Price API |   | Custody/RPC/Indexer |
                         +-----------+   +---------------------+
```

## 2. Modules

| Module | Responsibility |
| --- | --- |
| Asset Registry | Assets, fiat currencies, networks, asset-network mappings |
| Market Registry | Enabled pairs, spreads, fees, order limits, quote TTL |
| Market Data | Immutable provider observations, conversion routes, safety guards, reference-rate snapshots |
| Quote Engine | Spread, purchase-fee and amount calculation from an accepted reference snapshot |
| Purchase Engine | Quote acceptance, inventory reservation, settlement handshake |
| Withdrawal Engine | Fee estimate, policy evaluation, custody submission, finality tracking |
| Treasury | Wallet registry, confirmed balances, reservations, safety and gas buffers |
| Provider Gateway | Price, custody, fee, address, and chain-status adapters |
| Webhook Outbox | Durable, signed, retryable events to Sendaza |
| Reconciliation | Provider/chain holdings versus SLE inventory and Sendaza liabilities |
| Operations | Configuration, approval, replay, incident, and audit interfaces |

## 3. Provider Interfaces

```typescript
interface PriceProvider {
  getPrice(input: PriceRequest): Promise<PriceResult>;
}

interface CustodyProvider {
  getBalance(input: BalanceRequest): Promise<BalanceResult>;
  createTransfer(input: TransferRequest): Promise<TransferSubmission>;
  getTransfer(input: TransferLookup): Promise<TransferStatus>;
}

interface NetworkAdapter {
  validateAddress(address: string): AddressValidation;
  estimateFee(input: FeeRequest): Promise<FeeEstimate>;
  getTransaction(hash: string): Promise<ChainTransaction>;
}
```

Domain services depend on these interfaces, never a vendor SDK directly.

The MVP implements `CustodyProvider` with the Fireblocks Developer Sandbox.
SLE authenticates to Fireblocks using deployment-managed API credentials and
refers to wallets by provider wallet ID. Fireblocks creates and protects the MPC
key shares, signs approved transactions, and broadcasts them. SLE never handles
raw treasury private keys or seed phrases.

Custody routing is trusted server-side configuration. A client request cannot
choose the provider, wallet, or approval mode. Automated withdrawals must pass
both SLE policy checks and the custody provider's independent transaction-policy
rules; exceptional withdrawals enter manual review.

## 4. Purchase State Machine

```text
QUOTED
  | accept before expiry
  v
RESERVED
  | Sendaza reports customer ledger settlement
  v
COMPLETED

QUOTED ----> EXPIRED
RESERVED --> FAILED_RELEASED
RESERVED --> RECONCILIATION_REQUIRED
```

Rules:

- `QUOTED` does not reserve inventory in MVP.
- Transition to `RESERVED` uses a database transaction and row-level/optimistic concurrency.
- A reservation has an expiry for missing Sendaza settlement acknowledgement.
- Expired reservations are not blindly released when Sendaza outcome is unknown; they move to reconciliation.
- `COMPLETED` is immutable. Corrections use linked compensating records.

## 5. Withdrawal State Machine

```text
CREATED
  -> POLICY_APPROVED
  -> SUBMITTED
  -> BROADCASTED
  -> CONFIRMING
  -> CONFIRMED

CREATED/POLICY_APPROVED -> REJECTED
SUBMITTED               -> SUBMISSION_UNKNOWN
SUBMITTED               -> FAILED_BEFORE_BROADCAST
BROADCASTED/CONFIRMING   -> REPLACED or FAILED_ON_CHAIN
Any uncertain state     -> RECONCILIATION_REQUIRED
```

Rules:

- Only `FAILED_BEFORE_BROADCAST` proves funds may be released immediately.
- A timeout after submission is not proof of failure.
- Transaction replacement retains both original and replacement hashes.
- Finality is based on configured network confirmations and provider/chain verification.

## 6. Availability Calculation

For each asset/network treasury:

```text
sellable inventory =
  confirmed controlled holdings
  - customer crypto liabilities
  - pending withdrawal principal
  - purchase reservations
  - network fee reserve
  - configured safety buffer
```

SLE must not create a reservation when the result would become negative or fall below the market's minimum operating threshold.

Customer liabilities may be reported at the asset level, but controlled holdings
and withdrawal capacity are always tracked by `asset_network_id`. For example,
USDT on Ethereum and USDT on Tron are separate treasury inventories. Holdings on
one network cannot satisfy a withdrawal on another network until an explicit,
confirmed, and reconciled rebalance or bridge operation moves the backing.

## 7. Data Model

All IDs are UUIDs. All timestamps are UTC. Financial quantities are stored as arbitrary-precision integers in atomic units where the asset supports a fixed atomic unit; display decimals are derived from asset metadata.

### Configuration

```text
assets
- id, symbol, name, kind, decimals, status

fiat_currencies
- id, code, name, decimals, status

networks
- id, code, name, native_asset_id, address_family
- required_confirmations, status

asset_networks
- id, asset_id, network_id, token_standard, contract_address
- network_decimals, provider_asset_code, status
- deposits_enabled, withdrawals_enabled
- min_withdrawal_atomic, max_withdrawal_atomic
- fee_strategy, fee_buffer_bps, fee_quote_ttl_seconds
- UNIQUE(asset_id, network_id)

markets
- id, base_asset_id, quote_fiat_id
- default_backing_asset_network_id
- spread_bps, fixed_fee_atomic, min_order_atomic, max_order_atomic
- quote_ttl_seconds, status, configuration_version

providers
- id, code, provider_type, status, encrypted_configuration_reference

provider_routes
- id, capability, asset_network_id, provider_id, priority, status
- provider_wallet_id, provider_asset_code
- UNIQUE(capability, asset_network_id, provider_id)
```

### Purchase

```text
quotes
- id, market_id, side, source_amount_atomic, destination_amount_atomic
- provider_rate, customer_rate, spread_amount_atomic, fee_amount_atomic
- inventory_snapshot_id, configuration_version, expires_at, status

purchases
- id, quote_id, asset_network_id, customer_reference
- client_lock_reference, client_reference, correlation_id
- debit_atomic, credit_atomic, status, reservation_expires_at
- completed_at, rolled_back_at, reconciliation_required_at

purchase_settlements
- id, purchase_id, outcome, client_settlement_reference
- client_settled_at, recorded_at

purchase_transitions
- id, purchase_id, from_status, to_status, reason_code
- correlation_id, occurred_at

purchase_timeout_jobs
- id, purchase_id, status, due_at, lease_token, lease_expires_at
- attempt_count, created_at, updated_at
```

### Withdrawal

```text
withdrawal_fee_quotes
- id, asset_network_id, principal_atomic, network_fee_atomic
- native_fee_asset_id, native_fee_atomic, conversion_rate
- fee_buffer_atomic, service_fee_atomic, total_debit_atomic
- fee_snapshot_id, expires_at

withdrawals
- id, asset_network_id, sendaza_customer_id, sendaza_lock_reference
- client_reference, idempotency_key, destination_address
- principal_atomic, network_fee_atomic, service_fee_atomic, status
- custody_provider_id, provider_transfer_id, current_tx_hash
- required_confirmations, observed_confirmations

withdrawal_transaction_hashes
- id, withdrawal_id, tx_hash, replacement_of_id, observed_at
```

### Treasury and reliability

```text
treasury_wallets
- id, asset_network_id, custody_provider_id
- provider_vault_id, provider_asset_id, public_address, address_tag
- role, verification_required, safety_buffer_atomic, gas_reserve_atomic
- stale_after_seconds, status

treasury_snapshots
- id, treasury_wallet_id, asset_network_id
- controlled_atomic, provider_available_atomic
- pending_atomic, frozen_atomic, locked_atomic, chain_confirmed_atomic
- reserved_atomic, allocated_atomic, safety_buffer_atomic, gas_reserve_atomic
- unavailable_atomic, sellable_atomic, verification_status
- provider_reference, observed_at, expires_at

treasury_inventory_state
- asset_network_id, latest_snapshot_id, sellable_atomic, reserved_atomic, allocated_atomic
- verification_status, evidence_expires_at, updated_at

treasury_sync_jobs
- treasury_wallet_id, status, next_sync_at
- lease_token, lease_expires_at, attempt_count, last_error_code

treasury_funding_intents
- treasury_wallet_id, asset_network_id, expected_atomic, status
- transaction_hash, actor_id, reason, observed_at, confirmed_at

network_fee_snapshots
- id, asset_network_id, transfer_type, native_fee_asset_id
- estimated_native_fee_atomic, fee_level, source
- block_reference, observed_at, expires_at

inventory_reservations
- id, asset_network_id, purchase_id, amount_atomic
- status, expires_at

liability_snapshots
- id, asset_id, sendaza_report_id, total_atomic, as_of

reconciliation_runs
- id, asset_network_id, holdings_atomic, liabilities_atomic
- pending_atomic, reserves_atomic, variance_atomic, status, as_of

outbox_events
- id, aggregate_type, aggregate_id, event_type, payload
- attempt_count, next_attempt_at, delivered_at

inbound_requests
- idempotency_key, operation, request_hash, response_code, response_body

audit_logs
- actor_type, actor_id, action, resource_type, resource_id, before, after, created_at
```

Example mappings:

```text
asset: USDT
  -> network: ETHEREUM, standard: ERC20, contract: 0x..., fees paid in ETH
  -> network: TRON,     standard: TRC20, contract: T...,  fees paid in TRX
  -> network: SOLANA,   standard: SPL,   mint: ...,       fees paid in SOL
  -> network: POLYGON,  standard: ERC20, contract: 0x..., fees paid in POL
```

Address validation, custody routing, fee estimation, limits, treasury wallets,
and reconciliation use `asset_network_id`, never the asset symbol alone.

## 8. Concurrency and Idempotency

- Unique constraint: `(operation, idempotency_key)`.
- Reusing a key with a different request hash returns `409 IDEMPOTENCY_KEY_REUSED`.
- Inventory is reserved in one database transaction using an atomic conditional update or serializable transaction.
- Provider calls use SLE order IDs as provider idempotency references when supported.
- Webhook event IDs are globally unique and retained.

## 9. Deployment

Initial deployment units:

```text
sle-api                 REST ingress
sle-worker              outbox, provider polling, finality monitoring
sle-reconciliation      scheduled solvency checks
PostgreSQL               authoritative SLE state
Redis                    optional rate limit/cache; never financial truth
```

The services can begin in one NestJS codebase with independently runnable processes. Kafka is optional; PostgreSQL outbox processing is sufficient for the MVP.
