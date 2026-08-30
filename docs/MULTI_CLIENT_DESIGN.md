# SLE Deferred Multi-Client Platform Design

**Status:** Deferred; not part of the Sendaza-only MVP

The MVP authenticates only Sendaza Core and does not implement external client
onboarding, tenant administration, per-client policies, or multiple liquidity
pool assignments. This document is retained solely as a possible post-MVP
architecture. It must not override `CURRENT_BASELINE.md` or
`DESIGN_DECISIONS.md`.

## Product Boundary

If external-client support is approved later, SLE may evolve into a reusable B2B
liquidity and blockchain-settlement platform. Sendaza is the only active MVP
client.

```text
Sendaza Core --------+
Partner App A -------+--> SLE Client API --> Liquidity/Treasury --> Blockchain
Partner App B -------+
```

Each client application owns its users, KYC, internal balances, authorization, and customer ledger. SLE owns quotes, execution orders, treasury inventory, external withdrawals, provider integrations, and execution evidence.

## Identity Model

```text
client_id             integrating business/application
customer_reference    opaque customer identifier assigned by that client
correlation_id         end-to-end diagnostic identifier
client_reference       client's unique operation identifier
sle_order_id           SLE's canonical order identifier
```

`customer_reference` is unique only within a client. Its safe identity is `(client_id, customer_reference)`. SLE does not use emails, phone numbers, Telegram IDs, or usernames as global identity.

## Client Authentication

In a future multi-client release, issue each client a key ID and secret.
Authenticate with HMAC over:

```text
HTTP method
request path
timestamp
nonce
SHA-256(raw request body)
```

SLE derives `client_id` from the verified credential. A caller-provided client header cannot establish authorization.

Controls:

- Store hashed secrets or secret-manager references.
- Require a short timestamp window.
- Store nonces to block replay.
- Permit two active credentials during rotation.
- Rate-limit by authenticated client and endpoint.

Production can move to OAuth 2.0 client credentials with asymmetric workload identity or mTLS.

## Tenant Isolation

Every client-owned record has a non-null `client_id`, including quotes, orders, idempotency records, events, audit logs, and liability reports.

Requirements:

- Repository methods require `ClientContext`; no unscoped client queries.
- Unique constraints include `client_id`.
- PostgreSQL Row-Level Security may add defense in depth.
- Cross-client operational views require audited privileged roles.
- Delivery queues and circuit breakers are isolated per client.

```text
UNIQUE(client_id, operation, idempotency_key)
UNIQUE(client_id, client_reference)
```

## Client Configuration

Each client has versioned configuration for:

```text
enabled markets and networks
purchase and withdrawal limits
spread and fees
quote lifetime
webhook endpoint and signing key
manual review thresholds
liquidity pool assignment
status and suspension reason
```

Client configuration can narrow capabilities but cannot bypass platform security, solvency, or compliance minimums.

## Liquidity Pool Models

### Shared pool

Multiple future clients may consume one treasury. This provides capital
efficiency but requires per-client reservations, exposure limits, reporting, and
tenant isolation. It is not implemented in the Sendaza-only MVP.

### Dedicated pool

A client receives separate treasury wallets and inventory. This improves financial isolation but requires more capital, wallets, gas reserves, and operations.

### Future recommendation

Introduce `pool_id` with the multi-client migration. The Sendaza-only MVP uses
one treasury pool and does not need client-pool assignment logic.

## Generic Settlement Contract

SLE contains no Sendaza ledger code.

Purchase:

```text
Client locks fiat
  -> SLE reserves crypto
  -> Client commits its ledger
  -> Client acknowledges settlement
```

Withdrawal:

```text
Client locks crypto
  -> SLE submits blockchain transfer
  -> SLE emits lifecycle events
  -> Client finalizes or releases its lock
```

APIs use `clientReference`, `customerReference`, and `clientLockReference`. Sendaza-specific references stay in the Sendaza adapter.

## Webhooks

Each future client registers HTTPS endpoints. SLE signs events with a
client-specific key.

```text
event_id
client_id
event_type
aggregate_id
client_reference
occurred_at
payload
```

One client's unavailable endpoint cannot block another client's event delivery.

## Liability Reporting

Each client submits a signed liability snapshot with an `as_of` cutoff. Pool liability is the sum of accepted client liabilities assigned to that pool.

Stale liability reports reduce or suspend that client's purchase capacity. Reports distinguish available balances, locked balances, unsettled purchases, and withdrawals reflected at the cutoff.

## Data Model Additions

```text
client_applications
- id, code, name, status, environment, created_at

client_credentials
- id, client_id, key_id, secret_hash_or_reference
- valid_from, expires_at, revoked_at

client_policies
- id, client_id, configuration_version, limits, fees, status

client_webhook_endpoints
- id, client_id, url, signing_key_reference, subscribed_events, status

liquidity_pools
- id, code, model, status

client_pool_assignments
- client_id, pool_id, asset_network_id, exposure_limit_atomic
```

Add `client_id` to every client-owned aggregate and `pool_id` to reservations, treasury accounting, and reconciliation.

## Client Onboarding

1. Approve the client commercially and for compliance.
2. Create the client record and sandbox credentials.
3. Configure markets, limits, pool, and webhook endpoint.
4. Exchange signing keys.
5. Run contract, idempotency, failure, and replay tests.
6. Validate liability reports.
7. Assign capped production exposure.
8. Rotate to production credentials and run a controlled pilot.

## API Naming

Keep the product name **Sendaza Liquidity Engine**, but use generic endpoints:

```text
/api/v1/quotes
/api/v1/purchases
/api/v1/withdrawals
/api/v1/liability-snapshots
```
