# Sendaza Engineering Handoff

**Audience:** Sendaza engineering, architecture, security, finance, and operations

**Purpose:** Explain what SLE owns, what is delivered, and what Sendaza must change for integration
**Status date:** 10 September 2026

## 1. Executive Summary

The Sendaza Liquidity Engine, or SLE, is a private backend service used only by
Sendaza Core. It will calculate executable crypto purchase quotes, reserve
treasury inventory, coordinate Fireblocks MPC withdrawals, track blockchain
finality, and provide reconciliation evidence.

SLE is not a customer wallet, ledger, KYC system, or frontend. Sendaza remains
the system of record for customers, available and locked balances, journal
entries, transaction history, authorization, and customer communication.

```text
Sendaza mobile/admin -> Sendaza Core -> private SLE API
                              ^              |
                              +-- webhooks --+
```

The two systems use separate PostgreSQL databases. Cross-service consistency
comes from local transactions, idempotent commands, durable outboxes, explicit
states, signed events, queries, and reconciliation. There is no distributed
database transaction between Sendaza and SLE.

## 2. Current Delivery Status

| Area | Status |
| --- | --- |
| Exact amounts and configurable asset, fiat, network, asset-network, and market registries | Delivered |
| Sendaza service authentication, replay protection, idempotency, audit, and durable outbox | Delivered |
| Provider observations, multi-leg pricing routes, safety guards, durable refresh worker, reference snapshots | Delivered |
| Executable purchase quotes, spreads, fees, limits, and quote endpoint | Delivered |
| Fireblocks wallet and treasury synchronization | Sprint 5 delivered; sandbox activation and funded-wallet demo require deployment credentials |
| Purchase reservation and ledger-settlement handshake | Delivered; joint Sendaza ledger integration remains |
| Cached network-fee quotes and withdrawal creation/submission | Delivered; sandbox provider activation remains |
| Fireblocks webhook ingestion, polling recovery, replacement evidence, and blockchain finality | Delivered; sandbox end-to-end validation remains |
| Reconciliation and production hardening | Later sprints |

Production pricing is intentionally inactive. No enabled pricing route, refresh
job, or currently valid reference snapshot exists in the Railway production
database. The sandbox is not approved for customer funds.

## 3. Ownership Boundary

### Sendaza owns

- Customer authentication, KYC, eligibility, limits, and transaction PIN
- Customer profiles and personally identifiable information
- Fiat funding and the append-only customer ledger
- Available and locked fiat and crypto balances
- Balanced purchase and withdrawal journal groups
- Purchase and withdrawal intents presented to customers
- Customer-facing fees, amounts, expiry, disclosures, status, and history
- Durable consumption of SLE events and customer notifications

### SLE owns

- Configurable reference-price routes and immutable provider evidence
- Purchase spread and fee policies and executable quote economics
- Quote expiry and exact calculation evidence
- Treasury holdings, safety buffers, gas reserves, and inventory reservations
- Fireblocks MPC custody integration; SLE never handles raw private keys
- Network-fee estimation and external withdrawal orchestration
- Provider and blockchain status, finality, and reconciliation evidence
- Signed, retryable lifecycle webhooks to Sendaza

Sendaza must display SLE quote and withdrawal economics without recalculating
them. SLE must never write Sendaza customer balances or ledger entries.

## 4. Required Sendaza Changes

### Priority 1: exact multi-asset ledger

The existing `NUMERIC(18,4)` design is insufficient for many crypto assets.
Adopt atomic-unit integers with per-asset decimal metadata, preferably, or an
approved crypto-specific representation with at least `NUMERIC(36,18)`.

- Carry all API monetary values as decimal strings, never JSON numbers.
- Reject excess precision rather than silently rounding it.
- Keep asset and network separate. USDT on Ethereum and USDT on Tron are
  different withdrawal and treasury routes even when customer liability is
  reported at the asset level.
- Use immutable balanced journal groups and compensating entries for correction.

### Priority 2: available and locked balances

Sendaza needs journal-backed lock operations for fiat purchases and crypto
withdrawals. A lock and its local intent/outbox command must commit in one
Sendaza database transaction. Ambiguous SLE outcomes remain locked until a
query or reconciliation proves the safe outcome.

### Priority 3: integration records

Persist at minimum:

```text
correlation_id
idempotency_key
customer_reference
client_reference
sendaza_lock_reference
sendaza_transaction_reference
sle_quote_purchase_or_withdrawal_id
sle_event_id
provider_reference and transaction_hash when returned
```

Enforce uniqueness for idempotency keys, client references, and received event
IDs within their approved scopes.

### Priority 4: private SLE client

Only Sendaza Core calls SLE. Mobile, web, bots, and admin browsers must not hold
SLE credentials or call SLE directly. The client must support:

- TLS and the agreed service-authentication scheme
- Exact raw-body HMAC signing with timestamp and nonce replay protection
- `Idempotency-Key` for mutations and `X-Correlation-Id` for all workflows
- Identical-body retry after timeout using the same idempotency key
- Conflict handling when a key is accidentally reused with another body
- Stable error-code mapping without parsing human-readable messages
- Query-by-SLE-ID or client reference after an uncertain response

### Priority 5: durable webhook receiver

Provide `POST /api/v1/integrations/sle/webhooks`. Verify the timestamp and
HMAC-SHA256 signature over `timestamp + period + exact_raw_body`. Store the event
before returning `2xx`. Duplicate event IDs return `2xx` without applying the
financial effect again. Processing should occur from a durable inbox/outbox,
not directly in the HTTP request.

The receiver must tolerate delayed, duplicated, and reordered events. It must
query SLE when an event conflicts with the current local state or an expected
event is missing.

### Priority 6: liability snapshots and reconciliation

Sendaza must periodically produce a signed, ledger-derived liability snapshot
at a precise UTC cutoff. It includes available plus locked customer crypto by
asset. SLE compares it with controlled holdings, reservations, withdrawals,
gas reserves, and safety buffers at the same cutoff.

## 5. Purchase Flow to Implement

```text
1. Sendaza requests an executable quote from SLE.
2. Sendaza displays the immutable amounts, fees, rate, and expiry.
3. Customer authorizes before expiry.
4. Sendaza atomically locks the exact fiat debit and creates an intent.
5. Sendaza submits quote ID, lock reference, and client reference to SLE.
6. SLE reserves the exact crypto inventory once.
7. Sendaza commits one balanced settlement journal group.
8. Sendaza sends the durable settlement acknowledgement to SLE.
9. Both systems converge through states, signed events, queries, and reconciliation.
```

On proven failure before reservation, Sendaza may unlock fiat. On timeout or an
ambiguous response, it keeps the fiat locked and queries; it must not assume
failure and refund automatically.

The purchase journal moves the net fiat settlement and platform fee from the
customer locked account, and moves the exact quoted crypto from treasury control
to the customer available account. Final account orientation follows the
approved Sendaza chart of accounts.

## 6. Withdrawal Flow to Implement

Sendaza requests a fee quote for an explicit asset and network, shows principal,
network fee, service fee, recipient amount, total debit, and expiry, then locks
the exact total after customer authorization. SLE validates policy and address,
submits through Fireblocks MPC, and tracks broadcast and finality.

Only a proven failure before broadcast permits automatic unlock. Provider
timeout, submission uncertainty, broadcast, or confirmation delay keeps funds
locked and enters query or reconciliation. Fireblocks API credentials are
service credentials, not treasury private keys; Sendaza and SLE never receive
raw signing keys or seed phrases.

## 7. Security and Data Rules

- Exchange secrets through an approved secret channel, never source control,
  tickets, chat, logs, or populated environment files.
- Support two active service keys during controlled rotation.
- Store opaque customer references in SLE requests; do not replicate customer
  profiles or unrelated PII.
- Redact authorization headers, signatures, complete nonces, and sensitive
  provider fields from logs.
- Carry correlation ID and aggregate ID through logs, calls, events, and support
  tooling.
- Treat destination addresses and transaction hashes as retained financial data.
- Separate sandbox and production identities, databases, custody workspaces, and
  webhook secrets.

## 8. Required Sendaza Integration Components

### 8.1 Private SLE API client

Build a server-side client inside Sendaza Core. Customer applications must call
Sendaza Core and must never receive SLE credentials.

For every protected SLE request, Sendaza supplies:

```text
X-SLE-Key-Id
X-SLE-Timestamp
X-SLE-Nonce
X-SLE-Signature
X-Correlation-Id
Idempotency-Key        # required for mutations
```

The signing value is UTF-8 text containing exactly these five fields separated
by newline characters, with no final newline:

```text
UPPERCASE_HTTP_METHOD
RAW_REQUEST_TARGET_INCLUDING_QUERY
RFC3339_UTC_TIMESTAMP
NONCE
LOWERCASE_SHA256_HEX_OF_EXACT_RAW_BODY
```

Sign that value with HMAC-SHA256 using the Sendaza-to-SLE shared secret and
encode the signature as unpadded base64url. Generate a new URL-safe nonce for
every attempt. When retrying a financial mutation after a timeout, send the
identical request body with the same `Idempotency-Key`; use a new nonce and
timestamp because request authentication and financial idempotency are separate.

### 8.2 Durable SLE webhook receiver

Sendaza must expose this production HTTPS endpoint, or an agreed equivalent:

```text
POST /api/v1/integrations/sle/webhooks
```

The HTTP handler must capture the exact raw request bytes before JSON parsing.
For each request:

1. Read `X-SLE-Event-Id`, `X-SLE-Timestamp`, `X-SLE-Signature`, and
   `X-Correlation-Id`.
2. Reject timestamps outside the agreed replay window.
3. Calculate HMAC-SHA256 over `timestamp + . + exact_raw_body` using the
   SLE-to-Sendaza webhook secret.
4. Encode the result as unpadded base64url and compare it in constant time.
5. Validate the body and require the header event ID to match `body.eventId`.
6. In one Sendaza PostgreSQL transaction, insert the event into a durable inbox
   with a unique event-ID constraint.
7. Return `2xx` only after that transaction commits.
8. Return `2xx` for an already stored event ID without posting ledger effects
   again. Process accepted events asynchronously from the inbox.

The receiver must tolerate duplicates, delays, and reordering. A signature-valid
event is evidence to store and process; it is not permission to bypass Sendaza's
state machine or post an unbalanced journal.

### 8.3 Sendaza ledger orchestration

Implement journal-backed available/locked balance operations and durable command
outboxes for purchases and withdrawals. Each Sendaza transaction must atomically
write the ledger journal, local intent state, and command/event outbox record.

- A quote only describes economics; it does not lock money or reserve crypto.
- Sendaza locks the exact quoted debit before requesting a purchase or withdrawal.
- Sendaza keeps the lock after timeouts, provider uncertainty, or broadcast.
- Sendaza unlocks automatically only after proven pre-broadcast failure or a
  cancellation that SLE explicitly confirms as safe.
- Confirmation events settle through one balanced, idempotent journal group.
- Corrections use linked compensating entries; completed history is not edited.

### 8.4 Reconciliation support

Sendaza must produce ledger-derived customer liability snapshots at an agreed
UTC cutoff and retain the identifiers required to trace every workflow across
Sendaza, SLE, Fireblocks, and the blockchain. Mismatches must enter an operations
queue and may activate a scoped circuit breaker; neither system silently creates
balancing entries.

## 9. Shared Configuration And Secret Exchange

Sendaza and the SLE operator must agree on two independent HMAC secret sets.
Using different secrets limits the impact and simplifies rotation.

### Sendaza-to-SLE API credential

The SLE operator configures this value on the Railway `api` service:

```text
SLE_SENDAZA_CREDENTIALS_JSON=
[
  {
    keyId: sendaza-production-1,
    secret: <at-least-32-random-bytes>
  }
]
```

Sendaza stores the matching key ID and secret in its production secret manager.
SLE accepts one or two entries to permit overlap during rotation. Key IDs contain
only letters, digits, `_`, or `-` and are at most 100 characters.

### SLE-to-Sendaza webhook configuration

Sendaza engineering supplies the deployed receiver URL. The SLE operator sets
these values on the Railway `worker` service:

```text
SLE_SENDAZA_WEBHOOK_URL=https://<sendaza-api-host>/api/v1/integrations/sle/webhooks
SLE_SENDAZA_WEBHOOK_SECRET=<at-least-32-random-bytes>
```

Sendaza stores the same webhook secret in its production secret manager. The
production URL must use HTTPS and cannot contain embedded credentials or a URL
fragment. Exchange secrets through an approved encrypted secret-sharing channel,
never GitHub, tickets, email, ordinary chat, logs, or a committed `.env` file.

The Fireblocks API key/private authentication key and blockchain RPC URLs belong
only to SLE. Sendaza does not need or receive custody credentials, treasury keys,
seed phrases, or signing material.

## 10. End-To-End Example

```text
Customer             Sendaza Core             SLE               Fireblocks/chain
   |                       |                    |                        |
   | request withdrawal    |                    |                        |
   |---------------------->| fee quote          |                        |
   |                       |------------------->|                        |
   | display exact quote   |<-------------------|                        |
   | authorize             |                    |                        |
   |---------------------->| lock total debit   |                        |
   |                       | create withdrawal  |                        |
   |                       |------------------->| policy + durable job   |
   |                       |<-------------------|                        |
   |                       |                    | MPC submission         |
   |                       |                    |----------------------->|
   |                       | signed events      | webhook/poll/finality  |
   |                       |<-------------------|<-----------------------|
   |                       | settle journal only after confirmed evidence|
```

If any network call times out, the initiating system queries by its stored SLE
or client reference. It does not create a second command with a new idempotency
key and does not assume the transfer failed.

## 11. Work Sendaza Can Start Now

1. Approve the precision and atomic-unit migration design.
2. Define the crypto chart of accounts and balanced journal templates.
3. Implement reusable lock, unlock, settlement, and compensation primitives.
4. Add purchase and withdrawal intent tables with durable command outboxes.
5. Build the private SLE client shell with correlation and idempotency support.
6. Build the signed webhook inbox with raw-body capture and event deduplication.
7. Define status mappings that preserve ambiguous and reconciliation states.
8. Build ledger-derived liability snapshot generation.
9. Create restart, timeout, duplicate, reordering, and conservation tests.

Review the machine-readable contract and exercise `/quotes`, `/purchases`, and
`/withdrawals` only in the isolated sandbox until the joint acceptance gate is
passed. Mainnet and real customer funds remain prohibited.

## 12. Joint Decisions Before Integration

- Final service authentication and key-rotation ceremony
- Exact amount, fee, and rounding display policy
- Sendaza account normal-balance convention and journal approval
- Lock expiry, query cadence, and ambiguous-outcome operational ownership
- Stable API and webhook schemas with versioning rules
- Customer status wording and support escalation paths
- Liability snapshot frequency, signature, cutoff, and correction process
- Sandbox test assets, networks, markets, limits, and seed balances
- Recovery objectives, alert routing, incident ownership, and audit retention

## 13. Joint Acceptance Gate

- No customer frontend calls SLE or contains an SLE credential.
- Excess precision is rejected end to end and all monetary JSON values are strings.
- One idempotency key cannot create two effects in either system.
- Duplicate and reordered webhooks cannot duplicate journals.
- Every journal group balances and completed history is immutable.
- A restart or timeout at every external transition converges safely.
- Ambiguous purchase or withdrawal outcomes remain locked.
- Purchase and withdrawal conservation tests pass with real PostgreSQL.
- Reconciliation links Sendaza liabilities to SLE and custody evidence at one cutoff.
- API requests with invalid signatures, stale timestamps, or replayed nonces fail.
- Webhook requests with invalid signatures or stale timestamps fail without being stored.
- A duplicate webhook returns `2xx` but cannot create a duplicate journal group.
- Lost webhook delivery is recovered through retries and state queries.
- Mainnet and real funds remain blocked until security, compliance, treasury,
  custody, redundant pricing, backup, monitoring, and recovery gates are approved.

## 14. Information Sendaza Must Return To The SLE Team

Before the joint sandbox test, Sendaza engineering provides:

```text
1. Sandbox and production webhook URLs
2. Named technical owner and incident contact
3. Confirmation that raw-body capture occurs before JSON parsing
4. Confirmation of durable event-ID deduplication
5. Confirmation of atomic lock + intent + outbox transactions
6. Approved ledger precision and journal templates
7. Supported asset/network identifiers for the first sandbox route
8. Secret-exchange and credential-rotation procedure
9. Expected request rate, timeout budget, and maintenance windows
10. Evidence from duplicate, timeout, replay, and reordered-event tests
```

## 15. Canonical References

- `CURRENT_BASELINE.md` and `DESIGN_DECISIONS.md`
- `ARCHITECTURE.md`
- `API_SPEC.md`
- `LEDGER_INTEGRATION.md`
- `FRONTEND_BOUNDARY.md`
- `SECURITY_OPERATIONS.md`
- `TECH_STACK_MVP.md`
- `SPRINT_PLAN.md`

When documents conflict, the current baseline and accepted design decisions
take precedence. Contract examples must be updated alongside accepted behavior.
