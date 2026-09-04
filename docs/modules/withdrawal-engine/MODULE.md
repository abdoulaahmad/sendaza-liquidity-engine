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
`FAILED_ON_CHAIN`) are defined in `docs/ARCHITECTURE.md` Ã‚Â§5 and remain that
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

## Sprint 8 Safety Clarifications

Each withdrawal is bound before approval to exactly one enabled, server-selected
Fireblocks PRIMARY treasury wallet. The immutable wallet record supplies the
provider vault ID and provider asset ID. SLE never sends its internal
asset-network UUID as a Fireblocks asset identifier, and callers cannot choose
the wallet.

Initial submission and recovery use the same leased PostgreSQL job. When a
worker reclaims a withdrawal already in SUBMITTING or SUBMISSION_UNKNOWN, it
performs a Fireblocks lookup by external transaction ID instead of blindly
creating another transfer. Provider terminal statuses without independent
pre-broadcast proof move to RECONCILIATION_REQUIRED and keep the Sendaza lock.

The authenticated manual-review workflow is not implemented in Sprint 8.
Requests above the automatic threshold therefore fail before withdrawal
creation with WITHDRAWAL_REQUIRES_MANUAL_REVIEW instead of leaving an inert
CREATED record. The configured maximum fee-quote age is enforced during
creation in addition to the quote expiry timestamp.

## Implemented MVP Policy Gates

Before a withdrawal record is created, the repository evaluates all available
SLE-owned evidence in one database transaction:

- The destination must match the quote and pass the configured network address
  family. Sprint 8 enables EVM validation; unsupported production address
  families fail closed. TEST addresses exist only for isolated integration data.
- The latest accepted network-fee snapshot must still be fresh. Its buffered
  native fee cannot exceed the quote evidence by more than the active policy
  execution tolerance.
- The selected PRIMARY wallet requires fresh custody evidence and, when
  configured, independent MATCHED verification.
- Available wallet balance must cover the requested principal, configured safety
  buffer, and withdrawals committed since the cached evidence was observed.
  Approval locks the wallet row, preventing concurrent over-approval.
- Token withdrawals require exactly one enabled GAS wallet on the same network.
  Fresh gas-wallet evidence must cover the current buffered native fee while
  preserving its configured gas reserve.
- Optional daily per-customer amount and count limits, and optional
  first-time-destination review, are versioned policy fields. A triggered review
  fails before record creation until the authenticated review workflow exists.

External denylist, sanctions, and travel-rule screening require an approved
compliance provider and remain a production launch gate. SLE does not fabricate
a screening result.
---

# Sprint 9 Addendum: Webhooks and Blockchain Finality

## Status and Dependency

This is a specification for Sprint 9, not a claim that the behavior is already
implemented. It is based on the corrected Sprint 8 implementation in commit
b63aa3f. Sprint 9 starts with a withdrawal in SUBMITTED and a stored Fireblocks
transfer identifier. It must not weaken Sprint 8 wallet binding, policy gates,
leased recovery, or uncertain-outcome rules.

Sprint 9 is not ready for production until its forward migration, webhook
receiver, reconciliation workers, provider and chain adapters, tests, and
operational controls are implemented and verified against real PostgreSQL.

## Scope

Sprint 9 will:

- authenticate, persist, deduplicate, and asynchronously process Fireblocks
  Webhooks V2 events;
- independently poll non-terminal Fireblocks transfers so webhook loss cannot
  strand a withdrawal;
- store every provider transaction attempt, transaction hash, replacement link,
  and immutable confirmation observation;
- move withdrawals through broadcast and confirmation states using forward-only
  transitions;
- require independent chain evidence when the withdrawal's bound treasury wallet
  has verificationRequired enabled;
- detect evidence disagreement, stale evidence, unsupported replacement, and
  reorganization risk and route them to reconciliation.

Sprint 9 does not change quote economics, choose another treasury wallet, write
Sendaza balances, or automatically release a Sendaza lock after submission.

## State Machine Extension

Sprint 9 replaces Sprint 8's temporary post-submission terminal treatment with
these forward transitions:

~~~text
SUBMITTED -> BROADCASTED -> CONFIRMING -> CONFIRMED
                   |             |
                   +-> REPLACED <-+
                         |
                         +-> CONFIRMING -> CONFIRMED

SUBMITTED/BROADCASTED/CONFIRMING/REPLACED
  -> FAILED_ON_CHAIN
  -> RECONCILIATION_REQUIRED
~~~

SUBMITTED, BROADCASTED, CONFIRMING, and REPLACED are non-terminal. REPLACED
means a newer transaction attempt is now authoritative; it may move again to
CONFIRMING, another REPLACED, FAILED_ON_CHAIN, or RECONCILIATION_REQUIRED.
CONFIRMED is final for normal processing.

The Sprint 9 forward migration must replace the Sprint 8 database transition
trigger, which intentionally treated SUBMITTED as terminal until finality
tracking existed. No applied migration may be edited.

## Webhook Trust Boundary

The webhook endpoint accepts Fireblocks Webhooks V2 only. It verifies the
detached JWS in the Fireblocks-Webhook-Signature header against the exact raw
request bytes, using RS512 and the configured environment-specific Fireblocks
JWKS URL. Key rotation is supported by selecting the JWK by key ID and refreshing
the bounded JWKS cache. Legacy static-secret signature assumptions are not part
of this design.

Before cryptographic verification, the endpoint applies a strict body-size
limit, content-type validation, request timeout, and rate limiting. It must not
persist arbitrary headers or an unlimited untrusted body. Invalid requests may
store only an allowlisted, redacted rejection record containing a body hash,
received time, reason, and safe request metadata.

For a valid signature, SLE stores the exact raw body, the provider event ID,
event type, safe signature metadata, received time, and processing status before
acknowledging success. The provider event ID is unique. Duplicate delivery
returns success after confirming the existing inbox row and never reapplies the
financial transition. Business processing runs from a leased inbox job and is
safe after a crash or retry.

## Provider Polling and Evidence

A bounded worker polls every due post-submission withdrawal. It obtains the
current Fireblocks transfer status and transaction hash without holding a
database transaction open. The result is then committed through the same domain
transition function used by webhook processing.

Webhooks provide low-latency signals; they are not the sole authority. Polling
recovers missing events. For a withdrawal whose immutable treasuryWalletId
points to a wallet with verificationRequired, a provider claim alone can never
produce CONFIRMED. A network-specific read-only chain adapter must independently
match the transaction, asset, network, destination, amount, successful execution,
and required confirmation count. Missing, stale, or conflicting evidence enters
RECONCILIATION_REQUIRED.

## Transaction Attempts and Replacement

Every submission or replacement is a separate immutable transaction-attempt
record linked to one withdrawal. Each attempt has its own deterministic external
transaction ID and may have one or more observed hashes. A Fireblocks external
transaction ID is never reused for a replacement request.

Replacement is network-specific and fail-closed:

- EVM replacement uses the Fireblocks transaction-replacement operation for the
  current hash and records a new attempt linked to the replaced attempt.
- Bitcoin acceleration, including CPFP where supported, is a separate adapter
  capability with its own policy and evidence.
- Networks without an implemented and tested replacement adapter cannot be
  accelerated automatically.

The original attempt and hashes are never overwritten or deleted. Exactly one
attempt is current, enforced transactionally. Reordered events about an older
attempt remain audit evidence but cannot displace a newer current attempt.

## Finality and Reorganizations

Each observation stores its source, provider status, hash, block reference,
confirmation count, success or failure evidence, observed time, and normalized
payload hash. Observations are append-only.

Before the required confirmation threshold, a block disappearance or changed
canonical block is treated as a reorganization observation and the withdrawal
remains non-final while the current transaction is rechecked. If evidence
disagrees, or a reorganization is detected after SLE recorded CONFIRMED, SLE
does not silently reverse or rewrite completed history. It creates an incident,
emits an auditable reconciliation event, and enters the compensating workflow
defined by the reconciliation module.

FAILED_ON_CHAIN requires positive evidence that the broadcast transaction had
no successful asset-transfer effect. A dropped, replaced, or temporarily missing
transaction is not enough by itself. No post-submission failure automatically
releases the Sendaza lock in Sprint 9.

## Persistence Requirements

The Sprint 9 schema must add, at minimum:

- an inbound webhook inbox with unique provider event ID, raw-body storage for
  verified events, signature metadata, processing state, attempts, and lease;
- a withdrawal transaction-attempt table with unique deterministic external ID,
  provider transfer ID, replacement relationship, current-attempt constraint,
  and provider request hash;
- an append-only transaction-hash history linked to attempts;
- append-only provider and chain confirmation observations;
- bounded polling jobs with due time, attempts, lease owner, and lease expiry;
- incident or reconciliation linkage for conflicting and post-finality evidence.

Every accepted state transition and its outbound event commit in the same
PostgreSQL transaction. Workers claim bounded batches using leases and
FOR UPDATE SKIP LOCKED. Unique constraints, request hashes, and guarded state
transitions provide idempotency across process crashes.

## Events

Sprint 9 adds sle.withdrawal.broadcasted, sle.withdrawal.replaced,
sle.withdrawal.confirmed, and sle.withdrawal.failed_on_chain. Existing
sle.withdrawal.reconciliation_required remains the escalation event. Events use
stable IDs and the existing signed, at-least-once Sendaza outbox.

## Required Tests

- Valid Webhooks V2 signature, rotated JWK, invalid signature, oversized body,
  wrong content type, duplicate event, replay, delayed event, and reordered event.
- Crash after verified inbox persistence, crash during processing, and duplicate
  worker claims without duplicate transitions or events.
- Missing webhook recovered by polling; provider timeout remains uncertain.
- Provider and independent-chain agreement, mismatch, staleness, reverted
  execution, and wrong destination or amount.
- Confirmation threshold boundaries and chain reorganization before and after
  recorded finality.
- One and multiple EVM replacements, unique external IDs, immutable attempt/hash
  history, and stale events from replaced attempts.
- Unsupported-network replacement fails closed.
- Real PostgreSQL concurrency, lease-expiry, unique-constraint, migration, outbox,
  and restart tests.

## Delivery Gate and Deferred Work

Implementation must update the Prisma schema through a new forward migration,
the domain transition table, Fireblocks and chain adapter contracts, worker/API
wiring, OpenAPI and event contracts, canonical architecture documents, and the
Sprint 9 HTML/PDF learning report. The migration requires pre/post verification
in the isolated test database before production approval.

Automatic customer lock release or ledger correction after FAILED_ON_CHAIN, and
compensating action after a post-finality reorganization, remain owned by the
later reconciliation gate. Sprint 9 records trustworthy evidence and escalates;
it does not invent settlement authority.