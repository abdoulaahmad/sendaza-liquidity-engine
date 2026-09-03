# Purchase Engine Module

## Purpose and Boundary

The Purchase Engine consumes an unexpired Sprint 4 quote only after Sendaza has
locked the exact quoted fiat debit. It atomically reserves the quote's crypto
amount from fresh Sprint 5 inventory and later records Sendaza's committed or
proven-rollback outcome.

SLE never locks, debits, credits, or edits a Sendaza customer balance. Sendaza is
the sole customer ledger system of record. A purchase creates no blockchain
transfer; it allocates prefunded treasury backing to a Sendaza customer
liability.

## Commands

### Create purchase

```yaml
quoteId: quote-uuid
customerReference: opaque-sendaza-customer-reference
clientLockReference: sendaza-journal-backed-lock-reference
clientReference: sendaza-purchase-intent-reference
```

The body cannot select an asset-network, treasury wallet, custody provider,
amount, fee, or policy. Those values come from the immutable quote and current
inventory evidence.

### Record settlement

```yaml
status: COMMITTED | ROLLED_BACK
clientSettlementReference: sendaza-journal-reference
settledAt: 2026-09-02T15:00:00.000Z
```

`COMMITTED` means Sendaza atomically consumed the fiat lock, posted the fee and
principal journals, and credited the exact crypto liability. `ROLLED_BACK` means
Sendaza proves the lock was reversed before settlement. A timeout, missing
response, or unknown ledger outcome is not rollback proof.

## State Machine

```text
RESERVED --------------------------> COMPLETED
    |                                  customer liability allocated
    |
    +-- proven Sendaza rollback ----> ROLLED_BACK
    |                                  reservation released
    |
    +-- expiry / unknown outcome ---> RECONCILIATION_REQUIRED
                                       reservation remains held
```

`COMPLETED` and `ROLLED_BACK` are terminal and immutable. Corrections create
linked compensating records in later reconciliation work; they never rewrite a
terminal purchase.

## Atomic Reservation Transaction

1. Lock the quote row and reject an unknown, expired, or previously consumed quote.
2. Lock `treasury_inventory_state` for the quote's exact `asset_network_id`.
3. Require fresh `MATCHED` evidence and enough sellable atomic units.
4. Insert the purchase and its active inventory reservation.
5. Increase reserved inventory and decrease sellable inventory by the exact
   quote destination amount.
6. Insert `sle.purchase.reserved` into the outbox.
7. Commit every SLE state change together.

Unique database constraints on quote, client reference, and client lock
reference provide duplicate protection in addition to request idempotency.
Concurrent requests serialize on the inventory row and cannot oversell it.

## Settlement Transactions

For `COMMITTED`, SLE locks the purchase and inventory row, moves the reservation
from active reserved units to allocated liability units, records the immutable
settlement evidence and transition, and writes `sle.purchase.completed` to the
outbox in the same transaction.

For proven `ROLLED_BACK`, SLE releases the active reservation, recalculates
sellable inventory from the latest still-fresh safe snapshot, records the
rollback evidence and transition, and writes `sle.purchase.rolled_back` in the
same transaction. If evidence is stale or unsafe, released capacity remains
unsellable until treasury synchronization refreshes it.

Settlement commands for a terminal purchase cannot change the result. Reusing a
different settlement reference is a conflict.

## Timeout and Reconciliation

A leased worker finds overdue `RESERVED` purchases. It changes them to
`RECONCILIATION_REQUIRED`, keeps the inventory held, records a transition, and
emits an event. It never assumes that Sendaza failed to post its ledger merely
because an acknowledgement is late.

Operations resolve ambiguity using the client reference, lock reference,
settlement journals, correlation ID, purchase ID, and immutable transition
history. Manual actions must be authenticated, authorized, idempotent, and
audited.

## Responses and Events

All fiat and crypto amounts use decimal strings. Events use stable event IDs and
are delivered at least once through the existing signed Sendaza webhook outbox.
Sendaza must consume them idempotently.

## Known Reliability Dependency

The generic HTTP idempotency response and the purchase transaction currently
complete in separate local transactions. Database uniqueness prevents duplicate
allocation, but a crash after purchase commit and before response completion can
leave the key `IN_PROGRESS`. Automated recovery or transactional idempotency
completion remains required before a real-funds launch.

