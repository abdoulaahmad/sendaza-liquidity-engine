# Sendaza Liquidity Engine API Specification

**Base path:** `/api/v1`  
**Audience:** Private Sendaza services and operations clients  

The MVP accepts only authenticated Sendaza service credentials. External client
onboarding and public partner access are deferred. ETH/NGN and ETH/Ethereum
payloads below are illustrative examples of configuration-driven markets and
asset-network routes.

## 1. Protocol Rules

- TLS is mandatory; production service-to-service traffic uses mTLS or signed workload identity.
- Mutations require `Idempotency-Key` and `X-Correlation-Id`.
- Amounts and rates are decimal strings.
- Timestamps use RFC 3339 UTC.
- Sendaza customer IDs are opaque references; SLE does not receive customer PII unless required by an approved withdrawal compliance flow.
- API errors use stable machine-readable codes.

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_LIQUIDITY",
    "message": "The requested market amount is currently unavailable.",
    "correlationId": "3a339bf1-4b4f-453d-b69d-22488e24c532"
  }
}
```

## 2. Discovery

### `GET /assets`

Returns enabled assets and network capabilities.

### `GET /markets`

Returns enabled purchase markets, limits, and status. It does not return executable pricing.

## 3. Purchase API

### `POST /quotes`

```json
{
  "side": "BUY",
  "marketId": "0ed15b4a-483a-4938-a06c-13645a8c8118",
  "debitAmount": "200000.00"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "quoteId": "79622a38-f616-48b8-a4fc-da62df55fef2",
    "side": "BUY",
    "marketId": "0ed15b4a-483a-4938-a06c-13645a8c8118",
    "debitAmount": "200000.00",
    "tradeAmount": "197000.00",
    "fixedFeeAmount": "1000.00",
    "percentageFeeAmount": "2000.00",
    "totalFeeAmount": "3000.00",
    "referenceRate": "6000000.0000",
    "customerRate": "6060000.0000",
    "spreadAmount": "1950.49",
    "destinationAmount": "0.032508250825082508",
    "expiresAt": "2026-09-02T15:30:15.000Z",
    "configurationVersion": 5
  }
}
```

The body is strict: unknown fields and client-selected providers, routes,
policies, backing networks, or rounding modes are rejected. All monetary values
are decimal strings. `Idempotency-Key` and `X-Correlation-Id` are required.

### `POST /purchases`

Creates an inventory reservation after Sendaza has locked the fiat amount.

```json
{
  "quoteId": "00000000-0000-4000-8000-000000000001",
  "customerReference": "usr_123",
  "clientLockReference": "lock_fiat_456",
  "clientReference": "buy_789"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "purchaseId": "00000000-0000-4000-8000-000000000002",
    "quoteId": "00000000-0000-4000-8000-000000000001",
    "assetNetworkId": "00000000-0000-4000-8000-000000000003",
    "status": "RESERVED",
    "debitAmount": "200000.00",
    "creditAmount": "6250000.000000",
    "clientReference": "buy_789",
    "clientLockReference": "lock_fiat_456",
    "reservationExpiresAt": "2026-09-02T15:31:00.000Z",
    "createdAt": "2026-09-02T15:30:00.000Z"
  }
}
```

### `POST /purchases/:id/settlement`

Sendaza acknowledges that its ledger transaction committed.

```json
{
  "status": "COMMITTED",
  "clientSettlementReference": "TXN_abc123",
  "settledAt": "2026-09-02T15:30:22.000Z"
}
```

For a proven Sendaza rollback before settlement, `status` may be `ROLLED_BACK`.
Ambiguous outcomes must be queried and reconciled rather than reported as
rollback. A committed purchase returns `COMPLETED`; a late or missing settlement
acknowledgement becomes `RECONCILIATION_REQUIRED` and retains its inventory hold.

### `GET /purchases/:id`

Returns the authoritative SLE purchase state.

## 4. Withdrawal API

### `POST /withdrawal-fee-quotes`

```json
{
  "assetNetworkId": "00000000-0000-4000-8000-000000000001",
  "transferType": "TOKEN",
  "amount": "25.000000",
  "destinationAddress": "0x1111111111111111111111111111111111111111",
  "customerReference": "usr_123"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "feeQuoteId": "00000000-0000-4000-8000-000000000002",
    "assetNetworkId": "00000000-0000-4000-8000-000000000001",
    "transferType": "TOKEN",
    "principal": "25.000000",
    "estimatedNativeFee": "0.00100000",
    "bufferedNativeFee": "0.00120000",
    "networkFee": "0.300000",
    "serviceFee": "0.260000",
    "totalDebit": "25.560000",
    "recipientAmount": "25.000000",
    "expiresAt": "2026-09-03T08:00:30.000Z"
  }
}
```

`assetNetworkId` and `transferType` select one enabled route. An asset symbol
alone is insufficient. For example, USDT on Ethereum and USDT on Tron have
different IDs, native fee assets, estimators, policies, snapshots, treasury
wallets, custody routes, and inventory.

Fee quotes use the latest fresh cached fee snapshot for the selected
asset-network transfer type. SLE refuses the quote when the snapshot is stale or
missing. The withdrawal worker performs a final tolerance check before custody
submission without silently increasing the customer-approved debit.

### `POST /withdrawals`

Called only after Sendaza locks `totalDebit`. Consumes the immutable Sprint 7
withdrawal fee quote; the body cannot select an asset-network, principal, fee,
custody wallet, provider, or policy.

```json
{
  "feeQuoteId": "00000000-0000-4000-8000-000000000002",
  "customerReference": "usr_123",
  "clientLockReference": "lock_eth_555",
  "clientReference": "withdrawal_777",
  "destinationAddress": "0x1111111111111111111111111111111111111111"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "withdrawalId": "00000000-0000-4000-8000-000000000004",
    "feeQuoteId": "00000000-0000-4000-8000-000000000002",
    "assetNetworkId": "00000000-0000-4000-8000-000000000001",
    "status": "POLICY_APPROVED",
    "principal": "25.000000",
    "totalDebit": "25.560000",
    "clientReference": "withdrawal_777",
    "clientLockReference": "lock_eth_555",
    "destinationAddress": "0x1111111111111111111111111111111111111111",
    "createdAt": "2026-09-03T08:00:30.000Z"
  }
}
```

For the Sprint 8 MVP, a request within the automatic-approval threshold is
created and atomically advanced through CREATED to POLICY_APPROVED. Because the
authenticated manual-review command is not implemented yet, a request above the
threshold fails before record creation with WITHDRAWAL_REQUIRES_MANUAL_REVIEW;
it is never left as an inert CREATED withdrawal. The worker advances approved
withdrawals through SUBMITTING to SUBMITTED or SUBMISSION_UNKNOWN. A provider
terminal status without independent pre-broadcast proof produces
RECONCILIATION_REQUIRED and keeps the Sendaza lock. BROADCASTED onward is Sprint
9 scope.

### `GET /withdrawals/:id`

Returns the authoritative SLE withdrawal state: `status`, `principal`,
`totalDebit`, and the terminal timestamp field matching the current status
(`submittedAt`, `cancelledAt`, `rejectedAt`, `failedBeforeBroadcastAt`, or
`reconciliationRequiredAt`) when applicable.

### `POST /withdrawals/:id/cancel`

Permitted only in `CREATED` or `POLICY_APPROVED` and only while the submission
job remains unclaimed by a worker. Once a worker claims the job (entering
`SUBMITTING`), cancellation is rejected with `WITHDRAWAL_ALREADY_CLAIMED`; the
caller must instead await a terminal state, since the transfer may already be
irreversible. A successful cancellation returns the immutable `CANCELLED`
state and an `sle.withdrawal.cancelled` event that tells Sendaza releasing its
lock is safe.

## 5. Sendaza Liability Snapshot API

### `POST /reconciliation/liability-snapshots`

Sendaza periodically supplies ledger-derived liabilities, signed independently from ordinary service calls.

```json
{
  "reportId": "liab_20260829_1500",
  "asOf": "2026-08-29T15:00:00Z",
  "liabilities": [
    { "asset": "ETH", "amount": "12.500000000000000000" }
  ]
}
```

## 6. Webhooks From SLE to Sendaza

Endpoint owned by Sendaza:

```text
POST /api/v1/integrations/sle/webhooks
```

Headers:

```text
X-SLE-Event-Id
X-SLE-Timestamp
X-SLE-Signature
X-Correlation-Id
```

Signature input:

```text
timestamp + "." + raw_request_body
```

The signature is HMAC-SHA256 encoded as unpadded base64url. The timestamp is
RFC 3339 UTC and Sendaza validates it within the agreed replay window.

Example:

```json
{
  "eventId": "evt_01K4Y8",
  "type": "sle.withdrawal.confirmed",
  "occurredAt": "2026-08-29T15:36:00Z",
  "data": {
    "withdrawalId": "wdr_01K4Y7",
    "clientReference": "withdrawal_777",
    "asset": "ETH",
    "network": "ETHEREUM",
    "principal": "0.020000000000000000",
    "networkFee": "0.000700000000000000",
    "serviceFee": "0.000100000000000000",
    "transactionHash": "0xabc123",
    "confirmations": 12
  }
}
```

Event types:

```text
sle.purchase.reserved
sle.purchase.completed
sle.purchase.rolled_back
sle.purchase.reconciliation_required
sle.withdrawal.policy_approved
sle.withdrawal.rejected
sle.withdrawal.cancelled
sle.withdrawal.submitted
sle.withdrawal.broadcasted
sle.withdrawal.confirmed
sle.withdrawal.failed_before_broadcast
sle.withdrawal.reconciliation_required
sle.liquidity.warning
sle.liquidity.critical
sle.reconciliation.failed
```

Sendaza responds `2xx` only after durably storing the event. Duplicate event IDs return `2xx` without reapplying financial effects.

## 7. Error Codes

```text
ASSET_DISABLED
NETWORK_DISABLED
MARKET_DISABLED
QUOTE_EXPIRED
FEE_QUOTE_EXPIRED
ORDER_BELOW_MINIMUM
ORDER_ABOVE_MAXIMUM
INSUFFICIENT_LIQUIDITY
INVALID_DESTINATION_ADDRESS
DESTINATION_NOT_ALLOWED
POLICY_REVIEW_REQUIRED
IDEMPOTENCY_KEY_REUSED
PROVIDER_UNAVAILABLE
SUBMISSION_OUTCOME_UNKNOWN
WITHDRAWAL_ALREADY_SUBMITTED
WITHDRAWAL_ALREADY_CLAIMED
WITHDRAWAL_NOT_CANCELLABLE
RECONCILIATION_REQUIRED
```
