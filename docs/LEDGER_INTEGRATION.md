# SLE and Sendaza Ledger Integration

## 1. Ownership Rule

Sendaza's append-only ledger is the sole source of truth for customer balances. SLE records orders, inventory, treasury observations, and provider execution, but it never posts customer ledger entries.

Because Sendaza and SLE use separate databases, no workflow may claim cross-service ACID atomicity. Consistency is achieved through local transactions, durable outboxes, idempotent commands, explicit states, and reconciliation.

## 2. Precision Upgrade

The current Sendaza `NUMERIC(18,4)` wallet and ledger design cannot represent
many crypto assets accurately. Before integration, Sendaza must adopt one of:

1. Atomic-unit integer amounts with per-asset decimal metadata; preferred.
2. A crypto-specific `NUMERIC(36,18)` ledger and balance representation.

API values remain decimal strings. Conversion into atomic units must reject excess precision rather than round silently.

## 3. Account Model

Required Sendaza ledger accounts by asset:

```text
USER_AVAILABLE:<user>:<asset>
USER_LOCKED:<user>:<asset>
SLE_PURCHASE_SETTLEMENT:<asset>
SLE_WITHDRAWAL_SETTLEMENT:<asset>
TREASURY_CONTROL:<asset>
PLATFORM_FEE:<asset>
NETWORK_FEE_RECOVERY:<asset>
```

The precise debit/credit orientation must follow Sendaza's approved account normal-balance convention. The entries below describe value movement and must be implemented as balanced journal groups.

## 4. Purchase Journals

The following ETH/NGN amounts are an illustrative journal example only. The same
pattern applies to every configured fiat and crypto asset using its approved
precision and accounts. Customer quote economics come from SLE and Sendaza must
not recalculate them.

### Phase A: Lock fiat

```text
Move NGN 200,000:
  User NGN Available -> User NGN Locked
```

This local Sendaza transaction also creates the purchase intent and an outbox command.

### Phase B: SLE reserves the quoted crypto

SLE reserves the exact quoted ETH using its local transaction. No Sendaza balance changes occur.

### Phase C: Settle purchase

One Sendaza transaction posts:

```text
Move NGN 198,000:
  User NGN Locked -> SLE NGN Purchase Settlement

Move NGN 2,000:
  User NGN Locked -> Platform NGN Fee

Move ETH 0.032673267326732673:
  Treasury ETH Control -> User ETH Available
```

The same transaction updates read-model balances and writes a settlement acknowledgement to the outbox.

### Failure before SLE reservation

```text
User NGN Locked -> User NGN Available
```

### Ambiguous SLE outcome

Keep NGN locked. Query by idempotency/client reference. Do not create a refund until SLE proves that no reservation exists or the reservation is safely cancelled.

## 5. Withdrawal Journals

Example:

```text
Principal:   0.0200 ETH
Network fee: 0.0007 ETH
Service fee: 0.0001 ETH
Total debit: 0.0208 ETH
```

### Phase A: Lock customer crypto

```text
Move ETH 0.0208:
  User ETH Available -> User ETH Locked
```

The Sendaza transaction also creates a withdrawal intent and outbox command.

### Phase B: Confirmed on-chain

```text
Move ETH 0.0200:
  User ETH Locked -> SLE ETH Withdrawal Settlement

Move ETH 0.0007:
  User ETH Locked -> Network Fee Recovery

Move ETH 0.0001:
  User ETH Locked -> Platform ETH Fee
```

### Proven failure before broadcast

```text
User ETH Locked -> User ETH Available
```

### Broadcast or unknown outcome

Funds remain locked. A timeout, provider `5xx`, or missing webhook is not evidence that no transaction was broadcast.

## 6. Liability and Solvency Equations

```text
customer crypto liabilities =
  sum(customer available crypto)
  + sum(customer locked crypto)
```

```text
required controlled holdings =
  customer crypto liabilities
  + unpaid external withdrawal obligations not already reflected on-chain
  + operational gas reserve
  + safety buffer
```

```text
solvency surplus = confirmed controlled holdings - required controlled holdings
```

New purchases stop when the configured sellable inventory or solvency surplus would fall below zero.

## 7. Reconciliation Keys

Every financial workflow must be traceable through:

```text
correlation_id
idempotency_key
sendaza_transaction_reference
sendaza_lock_reference
sle_purchase_or_withdrawal_id
provider_transfer_id, when applicable
blockchain_transaction_hash, when applicable
```

## 8. Correction Rules

- Never update or delete historical journal entries.
- Corrections use a new compensating transaction linked to the original.
- SLE order history remains immutable; correction status and links are appended.
- Automated reconciliation may freeze activity but may not silently create balancing entries.
