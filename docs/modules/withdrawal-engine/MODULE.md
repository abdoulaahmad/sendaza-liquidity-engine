# Withdrawal Engine Module

## Purpose and Boundary

The Withdrawal Engine consumes an unexpired Sprint 7 withdrawal fee quote,
evaluates withdrawal policy, and submits an external blockchain transfer
through Fireblocks MPC custody. Sprint 8 stops at safe submission, lookup-based
timeout recovery, rejection, and the unresolved `SUBMISSION_UNKNOWN` state.
Transaction replacement, webhook processing, independent confirmation
verification, and on-chain finality are Sprint 9 scope and are not implemented
here.

SLE never locks, debits, credits, or edits a Sendaza customer balance. Sendaza
is the sole customer ledger system of record. A withdrawal creates a real
external blockchain transfer that moves treasury-controlled crypto to a
customer-controlled address; unlike a purchase, its principal effect is
irreversible once submitted and cannot be rolled back by any SLE action.

## Commands

### Create withdrawal

```yaml
feeQuoteId: withdrawal-fee-quote-uuid
customerReference: opaque-sendaza-customer-reference
clientLockReference: sendaza-journal-backed-lock-reference
clientReference: sendaza-withdrawal-intent-reference
destinationAddress: must match the fee quote's destination exactly
```

`clientLockReference` matches the accepted purchase and fee-quote contracts;
this module does not introduce a separate `sendazaLockReference` field. The
body cannot select an asset-network, transfer type, principal, fee, custody
wallet, provider, or policy. Those values come from the immutable fee quote.
`destinationAddress` is re-validated against the quote to prevent a
last-moment substitution.

### Cancel withdrawal

Permitted only in `CREATED` or `POLICY_APPROVED` **and** only while the
submission job remains unclaimed by a worker. Once a worker claims the job
(entering `SUBMITTING`), cancellation is rejected: the outcome is no longer
certain to be pre-submission, so the caller must instead await a terminal
state. The claim check and the cancellation write happen in the same
transaction as the job claim, using the same lease mechanism the refresh and
purchase-timeout workers already use, so a worker claim and a cancel request
cannot both succeed for the same withdrawal.

## State Machine

```text
CREATED
  -> POLICY_APPROVED
  -> SUBMITTING
  -> SUBMITTED
  -> BROADCASTED        (Sprint 9: confirmation and finality tracking)

CREATED/POLICY_APPROVED -> CANCELLED   (only while unclaimed; see Cancel above)
CREATED/POLICY_APPROVED -> REJECTED
SUBMITTING              -> SUBMISSION_UNKNOWN
SUBMITTING              -> FAILED_BEFORE_BROADCAST
Any uncertain state     -> RECONCILIATION_REQUIRED
```

`BROADCASTED` and beyond (`CONFIRMING`, `CONFIRMED`, `REPLACED`,
`FAILED_ON_CHAIN`) are defined in `docs/ARCHITECTURE.md` §5 and remain that
diagram's authority; Sprint 8 only reaches `SUBMITTED`/`SUBMISSION_UNKNOWN` and
records `provider_transfer_id` when Fireblocks returns one, but does not track
broadcast or confirmation. Sprint 9 picks up from `SUBMITTED` onward.

Only `FAILED_BEFORE_BROADCAST` is proof that funds were never moved and the
Sendaza lock may be released automatically. `CANCELLED` is a distinct terminal
state reached only through the pre-submission cancel path above; it is equally
safe for Sendaza to release its lock, and SLE emits an explicit event
confirming that. Every other uncertain terminal state (`SUBMISSION_UNKNOWN`,
`RECONCILIATION_REQUIRED`) keeps the customer lock in place until an operator
or Sprint 9 independent evidence resolves it.

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

## Submission Flow

Fireblocks is an external network call and must never execute while a
PostgreSQL transaction is open: holding a database transaction across a
network round-trip would block other rows, and a transaction cannot be rolled
back if the external call itself is ambiguous or already succeeded. Submission
is therefore split into two separate, independently committed transactions
plus one uncommitted external call between them, coordinated through a leased
submission job (the same claim/lease pattern as the treasury sync and
pricing-refresh jobs):

```text
Transaction 1 (fast, local)
  lock withdrawal row; reject unknown/expired/already-submitted fee quote
  re-verify current network-fee snapshot is within policy tolerance
  record POLICY_APPROVED + policy version
  create a leased submission job
  commit

Worker claims the job (FOR UPDATE SKIP LOCKED, bounded lease)
  transition withdrawal to SUBMITTING (separate small transaction)
  call Fireblocks.createTransfer, passing the withdrawal ID as externalTxId
  (Fireblocks' idempotency key) -- no open database transaction during this call

Transaction 2 (fast, local)
  on success: persist provider_transfer_id, move to SUBMITTED, write the
    sle.withdrawal.submitted outbox event, complete the job
  on definite pre-broadcast provider rejection: move to
    FAILED_BEFORE_BROADCAST, write the outbox event, complete the job
  on timeout/ambiguous provider response: move to SUBMISSION_UNKNOWN, write
    the outbox event, release the job for recovery polling
  commit
```

Step 2's timeout/failure classification never re-raises the customer debit
locked by the Sprint 7 fee quote; it only ever holds, releases (when proven
safe), or escalates to reconciliation.

## Timeout Recovery

If Fireblocks accepts the transfer but the response times out before SLE
receives `provider_transfer_id`, that ID is unknown to SLE and cannot be used
for recovery. Recovery instead queries Fireblocks by the SLE withdrawal ID,
which was supplied as `externalTxId` on submission and is therefore always
known locally regardless of whether the create-transfer response was
received. A recovery worker polls due `SUBMISSION_UNKNOWN` withdrawals,
looks up the transfer by `externalTxId`, and resolves to `SUBMITTED` (backfilling
`provider_transfer_id`), `FAILED_BEFORE_BROADCAST`, or leaves the withdrawal in
`SUBMISSION_UNKNOWN` for continued polling and eventual `RECONCILIATION_REQUIRED`
escalation after a bounded number of attempts.

## Failure Rules

- SLE never handles a treasury private key or seed phrase; all signing is
  Fireblocks MPC.
- No PostgreSQL transaction remains open across a Fireblocks network call.
- A timeout after provider submission is not proof of failure.
- Fund release before proven `FAILED_BEFORE_BROADCAST` (or a safe pre-claim
  `CANCELLED`) is forbidden; every other uncertain outcome enters
  reconciliation instead of blind release.
- Duplicate submission attempts cannot create a second provider transfer:
  `externalTxId` is the withdrawal's own ID, which is idempotent by
  construction and never changes across retries.
- Cancellation cannot race a worker's job claim; the claim and the cancel
  write serialize on the same leased job row.
- Completed (`SUBMITTED`, `FAILED_BEFORE_BROADCAST`, `REJECTED`, `CANCELLED`)
  states in this sprint's scope are immutable; corrections use linked
  compensating records.
- Financial state and its outbox event commit in one PostgreSQL transaction
  per step; no step spans an external call and a commit together.
- Execution cannot silently increase the customer-approved `totalDebit` locked
  by the Sprint 7 fee quote.

## Responses and Events

All amounts use decimal strings. Events (`sle.withdrawal.policy_approved`,
`sle.withdrawal.rejected`, `sle.withdrawal.cancelled`,
`sle.withdrawal.submitted`, `sle.withdrawal.failed_before_broadcast`,
`sle.withdrawal.reconciliation_required`) use stable event IDs and are
delivered at least once through the existing signed Sendaza webhook outbox.

## Known Dependencies and Open Decisions

- Requires Sprint 7's withdrawal fee quote as the sole source of principal,
  fee, and destination; this module does not recompute economics.
- Requires the Sprint 5 `CustodyProvider` write path (`createTransfer`,
  `getTransfer`), which Sprint 5 deliberately deferred to this sprint. The
  interface must accept an `externalTxId` parameter distinct from any
  provider-generated identifier, since recovery depends on it.
- Address/network validation rules (per network address family) are specified
  here at a high level; exact validators per address family are an
  implementation task tracked against this document.
- Transaction replacement, webhook consumption, independent confirmation
  checks, and on-chain finality are explicitly out of scope for Sprint 8 and
  are specified separately for Sprint 9.
