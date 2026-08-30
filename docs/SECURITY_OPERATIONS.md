# Sendaza Liquidity Engine Security and Operations

## 1. Security Objectives

- Prevent unauthorized treasury movement.
- Prevent duplicate allocation or withdrawal.
- Preserve customer asset backing and accurate financial records.
- Make every privileged action attributable and reviewable.
- Fail closed when price, provider, policy, or reconciliation state is uncertain.

## 2. Trust Boundaries

| Boundary | Required controls |
| --- | --- |
| Sendaza to SLE | Private network, mTLS/workload identity, scoped service authorization |
| SLE to custody | Provider allowlist, encrypted credentials, request signing, restricted source network |
| SLE to price providers | TLS, response validation, stale-price and deviation checks |
| SLE webhook to Sendaza | HMAC/asymmetric signature, timestamp window, event replay protection |
| Administrator to SLE | SSO, phishing-resistant MFA, RBAC, approval workflow, audit logs |

## 3. Key Custody

- SLE must not store, load, accept, or expose raw private keys, seed phrases, or exportable signing material in any environment.
- Use an MPC custody-provider sandbox for the MVP and a contracted MPC workspace for production.
- Store provider API credentials only in encrypted deployment secrets; never in PostgreSQL, source control, logs, or API responses.
- Persist only provider wallet IDs, public addresses, transfer IDs, and blockchain transaction hashes.
- Separate hot operational funds from warm/cold reserves.
- Restrict withdrawal sources, destinations, assets, amounts, and approvers through custody policies.
- Credential rotation and emergency revocation must be tested.
- Production and non-production custody workspaces must be isolated.
- Automated approval is limited by both SLE policy and independent custody-provider transaction policies.
- High-value, unusual, or elevated-risk withdrawals require manual review or approval.

## 4. Withdrawal Controls

Before provider submission, evaluate:

- Sendaza service identity and request signature
- Unique idempotency and client references
- Valid Sendaza lock reference
- Enabled asset/network route
- Exact address format and checksum where applicable
- Customer tier, amount, daily aggregate, and velocity limits
- Destination allowlist/blocklist and screening result
- Treasury and gas availability
- Fee-quote validity
- Manual approval threshold

Recommended MVP decisions:

```text
Small approved withdrawal: automatic
Large withdrawal: two-person approval
New/high-risk destination: hold for compliance review
Unavailable screening: hold, do not bypass
Provider timeout after submission: mark unknown, do not refund
```

## 5. Pricing Controls

- Use provider timestamps and reject stale data.
- Compare primary price to a fallback/reference price.
- Stop quoting when deviation exceeds a configured basis-point threshold.
- Store the raw provider price, customer price, spread, fee, source, and configuration version.
- Quotes are immutable and expire quickly.
- Administrators cannot retroactively change completed quote economics.

## 6. Treasury Operations

### Funding

1. Operations creates a funding intent containing asset, network, source, and expected amount.
2. A second authorized operator verifies the destination treasury address through an independent channel.
3. Funds are sent from the approved corporate source.
4. SLE detects the transaction but does not count it as confirmed liquidity until network finality.
5. Reconciliation associates the on-chain movement with the funding intent.

Treasury funding never credits a customer.

### Liquidity thresholds

Each asset/network defines:

```text
warning threshold
critical threshold
gas reserve
safety buffer
maximum daily allocation
maximum single withdrawal
```

At warning level, alert operations. At critical level, stop new purchases. Existing customer liabilities and valid withdrawal obligations remain visible and managed.

### Replenishment

MVP replenishment is manual. Automatic trading or exchange withdrawal is explicitly deferred until approval controls, counterparty limits, and reconciliation are mature.

## 7. Reconciliation

Run continuously for transaction states and at least daily for formal solvency attestation.

Inputs:

- Direct or independently verified blockchain balance
- Custody-provider balance and transaction history
- SLE reservations and withdrawals
- Sendaza ledger-derived customer liability snapshot
- Known in-flight chain transactions at the same cutoff time

Outputs:

- Confirmed controlled holdings
- Customer liabilities
- Unallocated/sellable inventory
- Pending outgoing amount
- Gas and safety reserves
- Explained timing differences
- Unexplained variance

Reconciliation must use a common `as_of` cutoff to avoid treating timing differences as losses.

Severity:

| Condition | Action |
| --- | --- |
| Stale data or small explained timing difference | Warning and retry |
| Unexplained positive variance | Freeze accounting adjustments; investigate |
| Any unexplained shortfall | Critical incident; stop purchases and high-risk withdrawals |
| Missing provider/chain evidence | Mark affected transactions reconciliation-required |

## 8. Webhook Reliability

- Write domain state and outbox event in the same local database transaction.
- Deliver at least once with exponential backoff and jitter.
- Sign the exact raw body and timestamp.
- Reject timestamps outside the approved window.
- Retain event delivery attempts and response summaries.
- Support controlled replay using the original event ID.
- Sendaza must store the event before acknowledging it.

## 9. Secrets and Data

- Secrets come from an approved secret manager, never source files or database defaults.
- Logs must exclude credentials, authorization headers, raw signing payloads, and unnecessary customer data.
- SLE stores opaque Sendaza customer references rather than replicated profiles.
- Destination addresses and transaction hashes are financial records and must follow retention/access policy.
- Database backups are encrypted and restoration is tested.

## 10. Observability

Minimum metrics:

```text
quote latency, error rate, stale-price rejection
purchase acceptance/completion/failure counts
available and reserved inventory by asset/network
withdrawal time in each state
provider submission errors and unknown outcomes
webhook delivery age and retry count
reconciliation variance and snapshot freshness
solvency surplus and threshold state
```

Every log and trace carries `correlation_id`, SLE aggregate ID, and safe provider reference.

## 11. Incident Playbooks

Required before launch:

- Suspected key or custody credential compromise
- Treasury balance below customer liabilities
- Duplicate or unintended withdrawal
- Provider timeout with unknown broadcast outcome
- Price-provider corruption or extreme deviation
- Webhook outage between SLE and Sendaza
- Sendaza/SLE settlement mismatch
- Chain congestion, reorganization, or stalled transaction
- Database recovery and outbox replay

## 12. Administrative Roles

| Role | Permissions |
| --- | --- |
| Viewer | Read dashboards and reconciliation reports |
| Liquidity operator | Create funding intents and manage non-financial configuration drafts |
| Withdrawal approver | Approve held withdrawals within limits |
| Compliance reviewer | Review screening holds and reject destinations |
| Security administrator | Manage service identities and emergency suspension |
| Super administrator | Break-glass only; cannot bypass immutable audit or approval quorum |

No single routine operator should be able to change a withdrawal destination and approve the same withdrawal.
