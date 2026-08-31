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
  "baseAsset": "ETH",
  "quoteCurrency": "NGN",
  "quoteAmount": "200000.0000",
  "customerReference": "usr_123"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "quoteId": "qt_01K4Y5ZVCC",
    "market": "ETH/NGN",
    "debitAmount": "200000.0000",
    "destinationAmount": "0.032673267326732673",
    "marketRate": "6000000.0000",
    "customerRate": "6060000.0000",
    "feeAmount": "2000.0000",
    "expiresAt": "2026-08-29T15:30:15Z",
    "configurationVersion": 4
  }
}
```

### `POST /purchases`

Creates an inventory reservation after Sendaza has locked the fiat amount.

```json
{
  "quoteId": "qt_01K4Y5ZVCC",
  "customerReference": "usr_123",
  "sendazaLockReference": "lock_ngn_456",
  "clientReference": "buy_789"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "purchaseId": "pur_01K4Y63E9J",
    "status": "RESERVED",
    "debitAmount": "200000.0000",
    "creditAsset": "ETH",
    "creditAmount": "0.032673267326732673",
    "reservationExpiresAt": "2026-08-29T15:31:00Z"
  }
}
```

### `POST /purchases/:id/settlement`

Sendaza acknowledges that its ledger transaction committed.

```json
{
  "status": "COMMITTED",
  "sendazaTransactionReference": "TXN_abc123",
  "settledAt": "2026-08-29T15:30:22Z"
}
```

For a proven Sendaza rollback before settlement, `status` may be `ROLLED_BACK`. Ambiguous outcomes must be queried and reconciled rather than reported as rollback.

### `GET /purchases/:id`

Returns the authoritative SLE purchase state.

## 4. Withdrawal API

### `POST /withdrawal-fee-quotes`

```json
{
  "asset": "ETH",
  "network": "ETHEREUM",
  "amount": "0.020000000000000000",
  "destinationAddress": "0x1111111111111111111111111111111111111111",
  "customerReference": "usr_123"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "feeQuoteId": "wfq_01K4Y6",
    "principal": "0.020000000000000000",
    "networkFee": "0.000700000000000000",
    "serviceFee": "0.000100000000000000",
    "totalDebit": "0.020800000000000000",
    "recipientAmount": "0.020000000000000000",
    "expiresAt": "2026-08-29T15:31:00Z"
  }
}
```

`asset` and `network` together select one enabled `asset_network` route. An
asset symbol alone is insufficient. For example, `USDT` on `ETHEREUM` and
`USDT` on `TRON` use different token identifiers, treasury wallets, native fee
assets, fee estimators, limits, custody routes, and available inventory.

Fee quotes use the latest fresh cached fee snapshot for the selected
asset-network transfer type. SLE refuses the quote when the snapshot is stale or
missing. The withdrawal worker performs a final tolerance check before custody
submission without silently increasing the customer-approved debit.

### `POST /withdrawals`

Called only after Sendaza locks `totalDebit`.

```json
{
  "feeQuoteId": "wfq_01K4Y6",
  "customerReference": "usr_123",
  "sendazaLockReference": "lock_eth_555",
  "clientReference": "withdrawal_777",
  "destinationAddress": "0x1111111111111111111111111111111111111111"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "withdrawalId": "wdr_01K4Y7",
    "status": "CREATED",
    "asset": "ETH",
    "network": "ETHEREUM",
    "principal": "0.020000000000000000",
    "totalDebit": "0.020800000000000000"
  }
}
```

### `GET /withdrawals/:id`

Returns status, provider reference, transaction hashes, observed confirmations, and terminal error when applicable.

### `POST /withdrawals/:id/cancel`

Permitted only before provider submission. Cancellation is a request, not a guarantee. A submitted or ambiguous withdrawal cannot be cancelled through this endpoint.

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
sle.purchase.failed
sle.withdrawal.policy_approved
sle.withdrawal.rejected
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
RECONCILIATION_REQUIRED
```
