# Core Reliability Module

## Purpose And Ownership

This module authenticates Sendaza service requests, prevents replay, provides
request idempotency, records security audit evidence, and persists outbound
events for at-least-once delivery. It does not own customer authentication,
Sendaza ledger entries, pricing, inventory, custody, or blockchain execution.

## Sprint 2 Scope

- Sendaza HMAC authentication and credential rotation
- Timestamp, nonce, and raw-body hash replay protection
- Correlation ID validation and propagation
- Request-hash idempotency with stored response replay
- Transactional outbox claims, retries, and quarantine
- Security and mutation audit records

Public client onboarding, administrator authentication, inbound provider webhook
verification, and domain-specific financial mutations are excluded.

## HMAC Contract

Sendaza supplies X-SLE-Key-Id, X-SLE-Timestamp, X-SLE-Nonce,
X-SLE-Signature, and X-Correlation-Id. Mutations also supply Idempotency-Key.

The canonical UTF-8 signing value contains exactly five newline-separated
fields and no final newline:

1. Uppercase HTTP method
2. Raw request target, including the query exactly as transmitted
3. RFC 3339 UTC timestamp
4. Nonce
5. Lowercase SHA-256 hex digest of the exact raw body

The signature is HMAC-SHA256 encoded as unpadded base64url. Verification uses
constant-time comparison. The default timestamp window is 300 seconds. A nonce
is 16 to 128 URL-safe characters and is unique per credential until its replay
window expires. SLE persists the nonce before protected behavior is invoked.

The verified key ID establishes the fixed MVP client identity sendaza-core.
Caller-supplied identity values never establish authorization.

## Credential Rotation

Secrets exist only in encrypted environment configuration or a secret manager.
PostgreSQL stores key metadata and audit evidence, never the HMAC secret. Two
credentials may be active during rotation. Unknown, inactive, expired,
not-yet-valid, or revoked credentials fail closed.

## Idempotency Contract

The identity is client ID, operation, and idempotency key. The request hash
covers operation, authenticated client ID, method, raw request target, and exact
raw body.

- The first request atomically creates an IN_PROGRESS record.
- An identical completed request returns the stored status and body.
- A reused key with another hash returns 409 IDEMPOTENCY_KEY_REUSED.
- A matching request still running returns 409 IDEMPOTENCY_REQUEST_IN_PROGRESS.
- Completion and its financial mutation occur in the same transaction.

## Transactional Outbox

Domain state and its outbound event are inserted in one PostgreSQL transaction.
The worker claims a bounded batch with FOR UPDATE SKIP LOCKED, assigns a lease
token and expiry, delivers with the event ID as idempotency reference, and then
marks success. Failure schedules bounded exponential retry. Exhausted events are
quarantined. Expired leases can be reclaimed after a worker crash.

## Data And Constraints

Required tables are service_credentials, authentication_nonces,
idempotency_records, outbox_events, and audit_logs. Database constraints enforce
key uniqueness, credential-scoped nonce uniqueness, client-operation-key
idempotency uniqueness, valid response state, and non-negative attempts.

## Stable Failures

- 401 AUTHENTICATION_REQUIRED for missing or malformed authentication
- 401 INVALID_CREDENTIAL for an unusable key
- 401 INVALID_SIGNATURE for signature failure
- 401 STALE_REQUEST for a timestamp outside the window
- 409 REQUEST_REPLAYED for a reused nonce
- 400 INVALID_CORRELATION_ID for a missing or malformed correlation ID
- 400 IDEMPOTENCY_KEY_REQUIRED for a mutation without a key

Infrastructure uncertainty before nonce or idempotency persistence fails closed.
Responses do not expose credential existence beyond stable operational errors.

## Observability And Audit

Protected requests carry correlation ID, authenticated client ID, credential key
ID, operation, and an idempotency key when applicable. Never log secrets,
signatures, raw authorization material, customer payloads, or complete nonces.

## Acceptance Criteria

- Forged, stale, replayed, and unknown-key requests cannot reach controllers.
- Rotation permits two active keys and rejects a revoked key.
- Concurrent nonce insertion permits exactly one request.
- Concurrent identical commands produce one committed effect.
- Conflicting hashes cannot share an idempotency key.
- A committed outbox event survives API and worker restart.
- Expired leases are reclaimable and active leases are not.
- Retry exhaustion quarantines instead of discarding an event.
- Real PostgreSQL tests cover constraints, transactions, leasing, and races.
