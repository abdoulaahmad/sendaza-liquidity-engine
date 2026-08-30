# Sendaza Liquidity Engine Technology Stack

**Status:** Recommended MVP baseline

## Recommended Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Runtime | Node.js 24 LTS | Supported server runtime |
| Language | TypeScript strict mode | Shared engineering model with Sendaza |
| Framework | NestJS 11 | Modular API and workers |
| Database | PostgreSQL 16+ | Orders, inventory, idempotency, outbox, audit, reconciliation |
| ORM | Prisma | Schema, migrations, and type-safe persistence |
| Financial math | Atomic-unit `bigint`; `decimal.js` at quote boundaries | Exact arithmetic without floating point |
| Async work | PostgreSQL transactional outbox | Durable MVP jobs without Kafka complexity |
| Cache | Redis, optional | Rate limiting and non-authoritative caching |
| Contracts | OpenAPI 3.1 and JSON Schema | Generated clients and contract validation |
| Logging | Pino structured JSON | Correlated and redactable logs |
| Telemetry | OpenTelemetry and Prometheus-compatible metrics | Traces, metrics, and provider monitoring |
| Testing | Jest, Supertest, Testcontainers | Unit, API, PostgreSQL, and concurrency tests |
| Delivery | Docker and GitHub Actions | Reproducible builds and deployment gates |

NestJS, TypeScript, Prisma, and PostgreSQL match Sendaza's existing engineering stack. SLE still uses a separate database and deployment boundary.

## Monetary Representation

Use atomic-unit integers internally:

```text
NGN 1.00 = 100 kobo
ETH 1.00 = 1,000,000,000,000,000,000 wei
BTC 1.00 = 100,000,000 satoshi
```

Persist quantities using a reviewed integer range such as `NUMERIC(78,0)`. Use TypeScript `bigint` in domain logic. APIs carry decimal strings with explicit asset metadata.

Use `decimal.js` for rates, spreads, and conversion into atomic units. Reject excess precision instead of silently rounding customer principal.

## External Providers

### Custody

**Recommended for production: Fireblocks.** It provides MPC custody, vaults, API transaction submission, policy/approval controls, webhooks, and screening integration options. SLE stores provider identifiers and public blockchain data, never private keys.

**Lower-cost alternative: Tatum.** Evaluate it for sandbox or a controlled pilot based on custody architecture, policy controls, supported networks, support, and pricing.

Do not build a custom hot-wallet key manager for the MVP.

### Ethereum access

Use a managed RPC/indexer provider such as Alchemy, Infura, QuickNode, or Tatum. It must provide Ethereum RPC, receipts, fee data, transaction monitoring, and suitable rate limits.

Custody webhooks initiate processing, but SLE independently verifies important transaction state through RPC before final settlement.

### Market data

Use approved market-data providers for configured crypto reference pairs and a
second independent source for deviation checks. Prefer a sufficiently liquid
direct market when available; otherwise evaluate a versioned conversion route
such as `BTC/USDT x USDT/USD x USD/NGN`. Do not assume that USDT always equals
one USD.

Store input prices, timestamps, cross-rates, spread, fee, and configuration version. WebSocket consumers must detect stale feeds and sequence gaps; provider streams can drop messages.

### Address screening

Select a KYT/address-screening provider during compliance design. Fireblocks supports integrations with screening providers; direct Chainalysis or Elliptic integration may also be evaluated. Required but unavailable screening places a withdrawal in review.

## AWS Deployment

| AWS resource | Purpose |
| --- | --- |
| ECS Fargate | Run API and worker containers |
| Private Application Load Balancer | Sendaza-to-SLE ingress |
| Aurora/RDS PostgreSQL Multi-AZ | Authoritative database |
| RDS Proxy | Database connection management |
| ElastiCache Redis | Optional rate limiting/cache |
| Secrets Manager | Provider, webhook, and database credentials |
| KMS | Encryption keys |
| ECR | Container registry and scanning |
| CloudWatch | Logs, alarms, and dashboards |
| WAF | Public provider-webhook ingress where applicable |
| S3 Object Lock | Immutable reports if compliance approves |

Deploy workloads and databases in private subnets. Restrict outbound provider access. Extend Docker Compose locally with an independent SLE database.

## Service Processes

Use one codebase with three processes:

```text
sle-api
- quotes, purchases, withdrawals, status, configuration reads

sle-worker
- outbox delivery, custody submission, polling, confirmations

sle-reconciliation
- treasury snapshots, liability comparisons, alerts
```

Workers use database leasing and locking to prevent concurrent duplicate execution.

## Development Resources

Required local tools:

```text
Node.js 24 LTS
npm
Docker Desktop with Compose
PostgreSQL client
Git
OpenSSL
```

Useful additions:

```text
Bruno or Postman
Prisma Studio for non-production inspection
Anvil for deterministic local EVM testing
```

No smart contract is required for the MVP.

Required service accounts:

```text
Custody-provider sandbox
RPC/indexer sandboxes for enabled test networks
Primary and fallback market data
Address-screening sandbox
AWS development account
```

## Team

Minimum credible delivery ownership:

```text
1 senior backend/financial systems engineer
1 backend/integration engineer
1 platform/SRE engineer, at least part-time
1 security engineer for threat model and launch review
1 finance/treasury owner
1 compliance/legal owner
1 QA engineer for failure and integration testing
```

One engineer can create a prototype. Custody, reconciliation, security, and production approval need independent review.

## Environments

```text
local       fake providers and local PostgreSQL
test        Testcontainers and provider fixtures
sandbox     Sepolia and provider sandboxes
staging     production-like infrastructure without customer funds
production  mainnet with approved treasury limits
```

Adapters must have deterministic fakes so automated tests do not depend on live networks.

## CI/CD Gates

```text
TypeScript type check
lint and formatting
unit tests
PostgreSQL integration tests
API compatibility tests
concurrency and idempotency tests
dependency/container vulnerability scan
secret scan
migration validation
```

Production also requires manual approval, migration review, and treasury-impact assessment.

## Build Versus Buy

Build inside SLE:

- Asset, network, fiat, market, and provider registry
- Quote, fee, inventory, and reservation logic
- Purchase and withdrawal state machines
- Idempotency and transactional outbox
- Provider adapters
- Reconciliation and Sendaza contracts

Buy or consume as managed services:

- MPC custody and signing
- Blockchain RPC/indexing
- Market data
- KYT/address screening
- Cloud database, secrets, and monitoring

## MVP Selection

```text
Application:       NestJS + TypeScript
Persistence:       PostgreSQL + Prisma
Async processing:  PostgreSQL transactional outbox
Arithmetic:        bigint atomic units + decimal.js boundaries
Custody:           Fireblocks sandbox, subject to commercial review
Blockchain:        Managed network RPC/indexers plus custody verification
Pricing:           Configured direct or cross-rate routes with independent checks
Cloud:             ECS Fargate + RDS/Aurora + Secrets Manager
Observability:     OpenTelemetry + Pino + CloudWatch
Testing:           Jest + Supertest + Testcontainers + enabled test networks
```

## Official References

- Fireblocks capabilities: https://developers.fireblocks.com/docs/capabilities
- Fireblocks webhooks: https://developers.fireblocks.com/reference/vault-webhooks
- Tatum notifications: https://docs.tatum.io/reference/notifications-overview
- Coinbase Exchange APIs: https://docs.cdp.coinbase.com/exchange/introduction/welcome
- Coinbase WebSocket feed: https://docs.cdp.coinbase.com/exchange/websocket-feed/overview
- AWS Secrets Manager with ECS: https://docs.aws.amazon.com/secretsmanager/latest/userguide/integrating_how-services-use-secrets_ecs-sc.html
- AWS RDS managed credentials: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html
