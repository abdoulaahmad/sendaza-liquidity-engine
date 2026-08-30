# SLE Frontend and Client Experience Boundary

**Status:** Canonical design decision  
**Applies to:** Sendaza-only MVP  

## 1. Decision

SLE does not provide a customer-facing frontend.

Sendaza owns the complete customer experience through its existing mobile and
administrative applications. External partner interfaces are deferred.

```text
Sendaza Mobile/Admin --> Sendaza Core --> SLE API
```

Sendaza frontends must never call SLE directly. Requests pass through Sendaza
Core, which authenticates the customer, enforces KYC and authorization rules,
locks customer funds, and authenticates to SLE using its service credential.

## 2. Ownership

### Sendaza owns

- Customer registration and login
- KYC and eligibility
- Customer profiles and PII
- Fiat funding
- Available and locked balances
- Transaction PIN or additional authorization
- Purchase and withdrawal user interface
- Customer transaction history
- Customer notifications and support
- Required customer disclosures and confirmations

### SLE owns

- B2B quote and execution APIs
- Asset, network, fiat, and market configuration
- Crypto liquidity pools and reservations
- Treasury monitoring
- External withdrawal orchestration
- Provider and blockchain integrations
- Signed webhooks to Sendaza
- Reconciliation evidence and liquidity alerts
- Internal operational controls

## 3. Free MVP Interface

The approved free MVP contains no SLE graphical frontend.

Its interfaces are:

```text
OpenAPI documentation
Private Sendaza-to-SLE REST API
SLE signed webhooks
secured operational REST endpoints
structured logs and alerts
local database inspection during development
```

OpenAPI is for developers and approved integration testing. It is not a customer product surface.

Prisma Studio may be used only on a developer's local or isolated test database. It must never be exposed publicly or treated as the operational console.

## 4. Customer Purchase Experience

The Sendaza application displays:

```text
fiat amount to debit
crypto amount to credit
exchange rate
spread/fee disclosure
quote expiry
confirmation action
final Sendaza-ledger status
```

Sendaza Core obtains the executable quote from SLE. The customer never receives
SLE credentials and never calls `/quotes` or `/purchases` directly.

## 5. Customer Withdrawal Experience

The Sendaza application displays:

```text
asset and network
destination address
principal
network fee
service fee
total balance debit
expected recipient amount
status and transaction hash
```

Sendaza Core performs customer authorization and balance locking before
submitting to SLE. SLE lifecycle webhooks update Sendaza's internal transaction
state, which Sendaza then presents to its customer.

## 6. Operations Console

SLE should eventually have a restricted internal operations console, but it is not required to validate the core MVP.

The console is for SLE treasury, compliance, support, security, and platform operators. It is never a customer portal.

### Read capabilities

- Treasury holdings and gas reserves
- Available and reserved liquidity by pool
- Sendaza exposure and usage
- Purchase and withdrawal state
- Blockchain confirmations and transaction hashes
- Reconciliation runs and variances
- Liquidity warnings and circuit-breaker status
- Webhook deliveries and retry backlog
- Configuration versions and audit history

### Controlled actions

- Suspend or resume the Sendaza integration
- Disable a market, asset, or network
- Adjust Sendaza exposure limits through an approved workflow
- Review held withdrawals
- Replay a failed webhook delivery
- Rotate Sendaza service credentials and webhook keys
- Acknowledge and resolve reconciliation incidents
- Activate an emergency purchase/withdrawal circuit breaker

The console must not provide arbitrary balance editing, direct database access, raw private keys, or full secret display.

## 7. Operations Console Technology

When needed, use:

```text
React + TypeScript + Vite
Vercel Hobby for sandbox
SLE admin API
separate administrator authentication
role-based authorization
phishing-resistant MFA before production
```

Do not reuse Sendaza service credentials for human administrators. Integration
routes and operations routes require separate authentication audiences.

## 8. Delivery Timing

```text
Stage 1: SLE API, OpenAPI, Sendaza test client, and secured operational endpoints
Stage 2: Core purchase and withdrawal workflows validated
Stage 3: Minimal read-only operations dashboard
Stage 4: Approval, replay, configuration, and incident controls
Stage 5: Production-grade SSO, MFA, RBAC, and retained audit
```

Building a polished operations console before the state machines and reconciliation are correct would create a visual shell around unreliable financial behavior. The API and domain correctness remain the first priority.

## 9. Sendaza Integration Rule

SLE does not dictate how Sendaza presents purchases or withdrawals, but the
Sendaza integration must display the immutable SLE quote and fee economics
without recalculation.

```text
Sendaza customer -> Sendaza mobile -> Sendaza Core -> SLE
```

Sendaza Core, not its frontend, is the SLE security principal. Multi-client
frontend rules are deferred with the broader partner-platform design.

## 10. Acceptance Criteria

- SLE has no customer registration, login, wallet, or customer-history frontend.
- No browser/mobile/bot client contains SLE service credentials.
- Every SLE customer operation originates from authenticated Sendaza Core.
- The free MVP is fully testable through OpenAPI and an automated Sendaza client without a graphical console.
- Any later SLE console is restricted to internal operations and uses separate admin authentication.
- Prisma Studio and database credentials are never publicly exposed.
