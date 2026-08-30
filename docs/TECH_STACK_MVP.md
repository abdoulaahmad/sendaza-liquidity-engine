# SLE Free-First MVP Technology Stack

**Status:** Canonical MVP stack decision  
**Purpose:** Validate the Sendaza-only SLE using testnet and free service tiers  

This document supersedes paid production recommendations for the MVP phase. Production infrastructure remains a later launch decision.

## Stack

| Layer | MVP selection | Cost target |
| --- | --- | --- |
| Language/runtime | TypeScript on Node.js 24 LTS | Free/open source |
| Framework | NestJS | Free/open source |
| Application hosting | Railway API and worker services | Free/trial for early work; Hobby for complete sandbox |
| Database | Railway PostgreSQL | Included project service; sandbox only |
| ORM | Prisma | Free/open source |
| Financial math | TypeScript `bigint` atomic units and `decimal.js` | Free/open source |
| Jobs | Always-running worker using PostgreSQL leases and outbox | Included in application hosting |
| Ethereum network | Sepolia | Testnet only |
| Ethereum RPC | Alchemy Free | Free tier |
| Market data | Coinbase public market API | Free public feed, subject to terms |
| Fiat cross-rate | Versioned manual test configuration | Free |
| Custody and signing | Fireblocks Developer Sandbox through `CustodyProvider` | Free testnet sandbox, subject to access |
| API contracts | OpenAPI 3.1 and JSON Schema | Free/open source |
| Logging/tracing | Pino and OpenTelemetry | Free/open source |
| Tests | Jest, Supertest, Testcontainers | Free/open source |
| CI/CD | GitHub Actions | Free allowance |
| Monitoring | Railway logs, health checks, and free uptime checks | Low-cost sandbox |

## Deployment Shape

```text
Sendaza Core
  -> Railway SLE API
  -> Railway PostgreSQL
  -> Railway SLE worker and reconciliation
          |
          +--> Coinbase market data
          +--> Alchemy Sepolia RPC
          +--> Fireblocks Developer Sandbox
```

The MVP is containerized and restartable. The API and worker use one codebase
with different start commands. It has no in-memory financial queue, Redis,
Kafka, Kubernetes, or production custody workspace.

## Railway Service Design

HTTP functions serve:

```text
/api/v1/assets
/api/v1/markets
/api/v1/quotes
/api/v1/purchases
/api/v1/withdrawal-fee-quotes
/api/v1/withdrawals
/api/v1/provider-webhooks
```

The always-running worker processes bounded, leased batches:

```text
process-outbox
refresh-market-rates
refresh-network-fees
process-withdrawals
monitor-finality
reconcile
```

Each job:

1. Claims rows in PostgreSQL using a lease and `FOR UPDATE SKIP LOCKED`.
2. Processes a small configured batch.
3. Persists every transition.
4. Releases or expires its lease.
5. Records a heartbeat and repeats on the configured schedule.

The worker combines background processing and scheduled reconciliation for the
MVP. Audited administrative commands may trigger a run but never bypass leases,
idempotency, or persisted state.

## Database Responsibilities

Railway PostgreSQL stores all authoritative MVP state:

```text
Sendaza service credentials
Sendaza policies and webhook endpoint
assets, networks, fiat currencies, and markets
asset-network mappings, token contracts, fee policies, and provider routes
Sendaza sandbox liquidity pool
quotes and purchase orders
withdrawal fee quotes and withdrawals
inventory reservations
treasury and liability snapshots
network fee snapshots by asset-network and transfer type
idempotency and replay records
transactional outbox events
reconciliation runs and audit logs
```

Do not use process memory as financial state. Prisma uses the Railway PostgreSQL
connection supplied through encrypted service configuration.

## Testnet Treasury

Support two sandbox modes:

### Simulated

```text
pool: shared-sandbox
configured holdings: 100 ETH
chain movement: none
```

This mode validates quotes, concurrency, reservations, client isolation, and reconciliation logic.

### Sepolia

Use a Fireblocks Developer Sandbox MPC wallet and faucet ETH to demonstrate external withdrawals and confirmation monitoring.

Rules:

- Store Fireblocks API credentials in Railway encrypted environment variables.
- Store only the Fireblocks wallet ID and public address in SLE records.
- Use only Sepolia/testnet assets in the developer workspace.
- Never copy sandbox credentials, wallets, or policies into production.
- Keep Fireblocks behind the custody-provider interface so it can be replaced.
- Configure automatic approval only within approved sandbox limits.
- Poll provider status and accept signed provider webhooks, while independently verifying transaction finality through Alchemy.

Required custody configuration is deployment-managed rather than client supplied:

```dotenv
CUSTODY_PROVIDER=fireblocks
FIREBLOCKS_BASE_URL=https://sandbox-api.fireblocks.io
FIREBLOCKS_API_KEY=<encrypted-environment-secret>
FIREBLOCKS_API_PRIVATE_KEY=<encrypted-environment-secret>
FIREBLOCKS_VAULT_ACCOUNT_ID=<sandbox-vault-id>
```

The Fireblocks API private key authenticates SLE to the provider; it is not the
treasury wallet private key. No populated `.env` file is committed.

## Pricing

Pricing routes are configuration-driven. A route may use a reliable direct market
or compose reference legs:

```text
BTC/NGN  = BTC/USDT x USDT/USD x USD/NGN
SOL/GHS  = SOL/USD x USD/GHS
USDT/NGN = USDT/USD x USD/NGN
```

The sandbox may use versioned manual fiat cross-rates. SLE stores every source,
timestamp, conversion leg, stablecoin reference, spread, fee, and configuration
version. Manual rates are identified as test data in quote responses.

## Sendaza Integration Scope

The free MVP supports one authenticated service client: Sendaza Core.

- HMAC service credentials for Sendaza
- Sendaza-scoped idempotency and replay protection
- One registered Sendaza webhook endpoint and signing key
- One Sendaza sandbox liquidity pool
- Opaque Sendaza customer references

External client onboarding, tenant administration, per-client policies, and
shared-versus-dedicated client pool assignment are deferred.

## Required Accounts

```text
GitHub
Railway
Alchemy
Sepolia faucet access
Fireblocks Developer Sandbox
```

Coinbase public market data normally does not require a trading account. Review its market-data terms before broader use.

## Local Development

```text
Node.js 24 LTS
npm
Docker Desktop and Compose
local PostgreSQL container
Git
OpenSSL
```

Local tests use deterministic fake price, chain, and custody adapters. Automated
tests must not require Railway, Fireblocks, Alchemy, or live market data.

## Minimum Team

```text
1 backend engineer for SLE
1 Sendaza integration owner, potentially the same engineer
1 treasury/compliance owner for requirements
1 independent security reviewer before any mainnet pilot
```

## Free-Tier Guardrails

- Configure usage alerts wherever available.
- Disable provider automatic paid upgrades.
- Expect sleeping/cold-start behavior.
- Keep test volume below database, RPC, webhook, and function limits.
- Export important design/test artifacts outside free infrastructure.
- Do not promise uptime or settlement time based on free tiers.

## Production Upgrade Triggers

Move off the free architecture before any of these:

- Real customer funds or mainnet keys
- Approval to onboard external client applications
- Contractual uptime or settlement commitments
- Withdrawal volume requiring continuous monitoring
- Regulatory approval requiring custody, screening, or audit controls
- Free-tier limits affecting reconciliation reliability

Upgrade path:

```text
Railway sandbox        -> approved production container platform
Railway PostgreSQL     -> managed PostgreSQL with PITR and SLA
Fireblocks sandbox     -> contracted production MPC workspace
Single price source    -> primary plus independent fallback
Manual fiat rate       -> approved live FX provider
Basic HMAC             -> mTLS/OAuth workload identity
No KYT                 -> address and transaction screening
Free logs              -> retained centralized observability
```

## Official Free-Tier References

- Railway services: https://docs.railway.com/guides/services
- Railway workers and cron: https://docs.railway.com/guides/cron-workers-queues
- Railway pricing: https://railway.com/pricing
- Alchemy pricing: https://www.alchemy.com/pricing
- Coinbase Exchange APIs: https://docs.cdp.coinbase.com/exchange/introduction/welcome
