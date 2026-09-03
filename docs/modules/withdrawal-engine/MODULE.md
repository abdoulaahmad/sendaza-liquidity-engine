# Withdrawal Engine Module

## Purpose and Boundary

The Withdrawal Engine consumes an unexpired Sprint 7 withdrawal fee quote,
evaluates withdrawal policy, submits an external blockchain transfer through
Fireblocks MPC custody, and tracks it to broadcast and on-chain finality.

SLE never locks, debits, credits, or edits a Sendaza customer balance. Sendaza
is the sole customer ledger system of record. A withdrawal creates a real
external blockchain transfer that moves treasury-controlled crypto to a
customer-controlled address; unlike a purchase, its principal effect is
irreversible once broadcast and cannot be rolled back by any SLE action.

## Commands

### Create withdrawal

```yaml
feeQuoteId: withdrawal-fee-quote-uuid
customerReference: opaque-sendaza-customer-reference
sendazaLockReference: sendaza-journal-backed-lock-reference
clientReference: sendaza-withdrawal-intent-reference
destinationAddress: must match the fee quote's destination exactly
```

The body cannot select an asset-network, transfer type, principal, fee, custody
wallet, provider, or policy. Those values come from the immutable fee quote.
`destinationAddress` is re-validated against the quote to prevent a
last-moment substitution.

### Cancel withdrawal

Permitted only in `CREATED` or `POLICY_APPROVED`. A cancellation after
`SUBMITTED` is rejected; the caller must instead await the terminal state,
since the transfer may already be irreversible.

## State Machine

Per `docs/ARCHITECTURE.md` §5:

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

Only `FAILED_BEFORE_BROADCAST` is proof that funds were never moved and the
Sendaza lock may be released automatically. Every other uncertain terminal
state (`SUBMISSION_UNKNOWN`, an unresolved timeout, a missing webhook) enters
`RECONCILIATION_REQUIRED` and keeps the customer lock in place until an
operator or independent chain evidence resolves it.

## Policy Evaluation

A versioned withdrawal policy selects, server-side:

- automatic-approval thresholds by asset-network and transfer type;
- destination allow/deny rules (denylist screening result required or
  optional);
- manual-review triggers (amount, velocity, first-time destination);
- maximum fee-quote age accepted at submission time.

Automatic approval requires **both** SLE policy and Fireblocks' own
transaction-policy engine to approve; either rejection sends the withdrawal to
`REJECTED` or manual review. A client request cannot choose the approval mode.

## Submission Transaction

1. Lock the withdrawal row; reject an unknown, expired, or already-submitted
   fee quote.
2. Re-verify current network-fee snapshot is still within policy tolerance; if
   actual required cost now exceeds the locked `totalDebit` tolerance, reject
   or move to manual review rather than silently raising the customer debit.
3. Record `POLICY_APPROVED` and the policy version used.
4. Submit to Fireblocks using the withdrawal ID as the provider idempotency
   reference so a retried submission cannot create a second on-chain transfer.
5. Persist `provider_transfer_id` and move to `SUBMITTED` in the same
   transaction as the outbox event.

A provider timeout after step 4 is not proof of failure: the withdrawal moves
to `SUBMISSION_UNKNOWN` and a worker polls Fireblocks by `provider_transfer_id`
(idempotent by construction) to resolve the true outcome before any lock
release.

## Finality and Transaction Replacement

A `BROADCASTED` withdrawal tracks `current_tx_hash` and required confirmations
from the asset-network configuration. `withdrawal_transaction_hashes` retains
every hash, linking a replacement to `replacement_of_id` so a fee-bumped or
resubmitted transaction never loses its history. `CONFIRMED` requires the
configured number of independent confirmations from both custody-provider and
chain-adapter evidence; a provider-only report is insufficient for an
important-wallet asset-network per the treasury verification policy.

## Webhook and Polling Lifecycle

Fireblocks delivers webhooks for submission, broadcast, and confirmation
events; a bounded poller also reconciles state independent of webhook
delivery, since webhooks may be duplicated, delayed, reordered, or lost.
Webhook events are persisted before acknowledgement and processed
idempotently by provider event ID; a duplicate or reordered event cannot
regress a further-advanced withdrawal state.

## Failure Rules

- SLE never handles a treasury private key or seed phrase; all signing is
  Fireblocks MPC.
- A timeout after provider submission is not proof of failure.
- A broadcast transaction is not a confirmed transaction.
- Fund release before proven `FAILED_BEFORE_BROADCAST` is forbidden; every
  other uncertain outcome enters reconciliation instead of blind release.
- Duplicate submission requests cannot create a second provider transfer.
- Completed (`CONFIRMED`, `FAILED_BEFORE_BROADCAST`, `REJECTED`) withdrawals
  are immutable; corrections use linked compensating records.
- Financial state and its outbox event commit in one PostgreSQL transaction.
- Execution cannot silently increase the customer-approved `totalDebit` locked
  by the Sprint 7 fee quote.

## Responses and Events

All amounts use decimal strings. Events (`sle.withdrawal.policy_approved`,
`sle.withdrawal.rejected`, `sle.withdrawal.submitted`,
`sle.withdrawal.broadcasted`, `sle.withdrawal.confirmed`,
`sle.withdrawal.failed_before_broadcast`,
`sle.withdrawal.reconciliation_required`) use stable event IDs and are
delivered at least once through the existing signed Sendaza webhook outbox.

## Known Dependencies and Open Decisions

- Requires Sprint 7's withdrawal fee quote as the sole source of principal,
  fee, and destination; this module does not recompute economics.
- Requires the Sprint 5 `CustodyProvider` write path (`createTransfer`,
  `getTransfer`), which Sprint 5 deliberately deferred to this sprint.
- Address/network validation rules (per network address family) are specified
  here at a high level; exact validators per address family are an
  implementation task tracked against this document.
- Later finality and reconciliation sprints attach actual on-chain fee
  evidence and measure fee-estimate variance against Sprint 7's estimates.
