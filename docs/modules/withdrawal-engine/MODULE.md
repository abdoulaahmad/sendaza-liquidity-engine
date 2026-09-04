# Withdrawal Engine Module

## Purpose and Boundary

The Withdrawal Engine consumes an unexpired Sprint 7 withdrawal fee quote,
evaluates withdrawal policy, submits an external blockchain transfer through
Fireblocks MPC custody, and tracks that transfer through broadcast,
replacement, and independently verified finality. Sprint 8 delivered safe
submission, lookup-based timeout recovery, rejection, and the unresolved
`SUBMISSION_UNKNOWN` state, stopping at `SUBMITTED`. Sprint 9 (this addendum)
delivers everything from `SUBMITTED` onward: webhook ingestion, transaction
replacement, independent confirmation, and finality.

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

---

# Sprint 9 Addendum: Webhooks and Blockchain Finality

## Purpose and Boundary

Sprint 9 begins where Sprint 8 stops: a `SUBMITTED` withdrawal with a known
`provider_transfer_id`. It tracks that transfer to `BROADCASTED`, `CONFIRMING`,
and `CONFIRMED`, or to `REPLACED`/`FAILED_ON_CHAIN`, using both Fireblocks
webhooks and an independent polling reconciler, plus an independent
blockchain confirmation check for important-wallet asset-networks (mirroring
the Sprint 5 treasury verification policy). It does not change submission,
policy evaluation, or fee economics, and it does not release a Sendaza lock
early: `CONFIRMED` is the only state after `SUBMITTED` that lets Sendaza treat
the withdrawal as settled.

## State Machine

```text
SUBMITTED
  -> BROADCASTED
  -> CONFIRMING
  -> CONFIRMED

BROADCASTED/CONFIRMING -> REPLACED         (fee bump or stuck-transaction resubmission)
BROADCASTED/CONFIRMING -> FAILED_ON_CHAIN  (reverted or dropped after broadcast)
Any of the above       -> RECONCILIATION_REQUIRED  (evidence disagreement or timeout)
```

This extends, without altering, the Sprint 8 machine: `SUBMITTED` remains a
valid terminal state for a withdrawal that has not yet broadcast, and none of
Sprint 8's states or transitions change. `REPLACED` and `FAILED_ON_CHAIN` are
themselves non-terminal with respect to lock release: only `CONFIRMED` proves
the transfer settled, and only a proven `FAILED_ON_CHAIN` with an
independently confirmed zero-effect chain state (never a webhook claim alone)
allows fund release consideration — and even then the release decision is a
reconciliation/operations action, not automatic, because a withdrawal past
`SUBMITTED` has already left the custody provider's exclusive control.

## Webhook Ingestion

Fireblocks webhooks are external, unauthenticated-by-default HTTP requests and
therefore untrusted input until verified. Every inbound webhook:

1. Is persisted verbatim (raw body, headers, received-at) **before** signature
   verification or business processing, so a crash after receipt never loses
   the evidence — this mirrors the inbound-event rule already used for
   Sendaza-bound events in `docs/API_SPEC.md` §6.
2. Has its Fireblocks signature verified against the raw body; an invalid
   signature is stored with a `REJECTED_SIGNATURE` status and never reaches
   withdrawal state.
3. Is deduplicated by Fireblocks' own webhook event ID (unique constraint);
   a duplicate delivery is acknowledged `2xx` without reapplying any effect,
   matching the existing "delivery is at least once, consumers are idempotent
   by event ID" rule.
4. Is processed only after successful persistence and signature verification,
   inside its own PostgreSQL transaction — never inside the HTTP handler's
   response-blocking path, so a slow or failing side effect cannot stall the
   webhook acknowledgement Fireblocks expects.
5. Can never regress a withdrawal to an earlier state: an out-of-order or
   delayed webhook (e.g., a `SUBMITTED` event arriving after `CONFIRMED` was
   already recorded from an earlier webhook or poll) is accepted for audit
   but does not change `withdrawals.status` if the new state is not strictly
   ahead of the current one in the state machine above.

## Independent Polling Reconciliation

Webhooks may be duplicated, delayed, reordered, or **lost entirely** — SLE
cannot assume delivery. A bounded poller independently re-derives state for
every non-terminal, post-`SUBMITTED` withdrawal:

```text
due withdrawal (status in SUBMITTED/BROADCASTED/CONFIRMING, past its poll interval)
              |
              v
Fireblocks.getTransfer(provider_transfer_id) -- provider-reported status/hash
              |
              v
important-wallet asset-network? --yes--> independent chain adapter lookup by tx hash
              |                                        |
              no                                MATCH / MISMATCH / STALE
              |                                        |
              v                                        v
     apply provider status alone           MISMATCH/STALE -> RECONCILIATION_REQUIRED
                                            MATCH -> apply confirmed status
```

This is the same "important wallet requires independent verification, provider
claim alone is insufficient" rule Sprint 5 already applies to treasury
balances, extended to withdrawal confirmation. The poller and the webhook
handler share one state-transition function so both paths enforce identical
forward-only rules and identical evidence requirements.

## Transaction Replacement

A withdrawal may be resubmitted with a bumped fee (RBF-style) or as a fresh
attempt after a stuck unconfirmed transaction. Replacement:

- Never mutates the original transaction-hash record; a new
  `withdrawal_transaction_hashes` row is inserted with
  `replacement_of_id` pointing at the prior hash, preserving full history.
- Requires the same `externalTxId` idempotency discipline as Sprint 8:
  Fireblocks' own replacement/resubmission flow is used so SLE never invents
  a second independent transfer for the same withdrawal.
- Moves the withdrawal to `REPLACED` only as an intermediate marker while the
  new hash is tracked; the withdrawal continues through `CONFIRMING` ->
  `CONFIRMED` under the replacement hash, and `current_tx_hash` always points
  at the currently tracked hash.
- A withdrawal can be replaced multiple times; the hash chain is fully
  auditable via `replacement_of_id`.

## Finality Rules

- `CONFIRMED` requires the asset-network's configured
  `required_confirmations` from the provider **and**, for an important-wallet
  asset-network, an independently matching chain-adapter confirmation count.
  A provider-only report is insufficient for those asset-networks, matching
  Sprint 5's treasury verification policy.
- A dropped, reverted, or double-spent transaction after broadcast is
  `FAILED_ON_CHAIN`, never silently retried as if it had not happened; it
  requires operator/reconciliation review before any corrective action.
- Confirmation count evidence and its `observed_at` timestamp are stored
  immutably per observation, the same pattern as treasury snapshots and
  network-fee observations, so finality is always reproducible from stored
  evidence rather than recomputed from a live-only provider call.

## Failure Rules

- A broadcast transaction is not a confirmed transaction; `BROADCASTED` and
  `CONFIRMING` are both non-terminal with respect to any customer-facing
  settlement claim.
- Webhook loss cannot lose state: the independent poller is the ultimate
  authority, and its cadence is bounded specifically so no withdrawal can
  remain stuck solely because a webhook never arrived.
- A forged, delayed, reordered, or duplicated webhook cannot move a
  withdrawal backward in the state machine, apply an effect twice, or bypass
  signature verification.
- Provider/chain evidence disagreement or staleness on an important wallet
  never resolves in favor of the more optimistic status; it always escalates
  to `RECONCILIATION_REQUIRED`.
- Replacement retains, and never deletes or overwrites, prior transaction
  hashes.
- Financial state and its outbox event still commit in one PostgreSQL
  transaction per step; the same no-open-transaction-across-an-external-call
  rule from Sprint 8 applies to every Fireblocks/chain-adapter call this
  sprint adds.

## Responses and Events

Adds `sle.withdrawal.broadcasted`, `sle.withdrawal.replaced`,
`sle.withdrawal.confirmed`, and `sle.withdrawal.failed_on_chain` to the event
set already defined for Sprint 8. All continue to use stable event IDs and
the existing signed, at-least-once, idempotent-by-event-ID Sendaza webhook
outbox.

## Test Plan Additions

- Duplicate, forged (invalid signature), delayed, reordered, and entirely
  missing webhook scenarios, each proving state either advances correctly or
  is correctly rejected/ignored without regression.
- Provider/independent-chain agreement and disagreement on confirmation
  count and transaction status for an important-wallet asset-network.
- A stuck unconfirmed transaction replaced once, and replaced a second time,
  with the full hash chain verified via `replacement_of_id`.
- Sendaza/SLE restart at every external transition in this sprint (after
  persisting a webhook but before processing it; after a poll observation but
  before committing state; after committing `CONFIRMED` but before the
  outbox event is delivered).

## Known Dependencies and Open Decisions

- Requires Sprint 8's `SUBMITTED` state and `provider_transfer_id` as its
  entry point; does not revisit submission or policy evaluation.
- Requires a `NetworkAdapter`-style independent chain lookup by transaction
  hash and confirmation count, extending the read-only chain balance adapter
  already used for Sprint 5 treasury verification (`docs/ARCHITECTURE.md`
  §3) to transaction-level queries.
- Fireblocks webhook signature verification scheme and replay-window
  parameters must be confirmed against current Fireblocks documentation
  before implementation; this is a pre-implementation research task, not an
  open financial-invariant question.
- Reconciliation of a proven `FAILED_ON_CHAIN` withdrawal into an automatic
  or manual fund-release decision is deferred to the Sprint 11 Reconciliation
  Gate; Sprint 9 only reaches and records `FAILED_ON_CHAIN` accurately.
