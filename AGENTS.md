# SLE Contributor Instructions

## Project Purpose

The Sendaza Liquidity Engine (SLE) is a private Sendaza-only service for the MVP.
It owns configurable crypto/fiat pricing routes, executable purchase quotes,
spreads, purchase fees, treasury reservations, Fireblocks MPC custody integration,
network-fee estimation, external withdrawals, blockchain finality tracking, and
treasury reconciliation.

Sendaza remains the customer and accounting system of record. It owns customer
authentication, KYC, transaction authorization, balance locks, double-entry
ledger entries, transaction history, and customer-facing interfaces.

Read these documents before changing financial behavior:

- `docs/CURRENT_BASELINE.md`
- `docs/DESIGN_DECISIONS.md`
- `docs/ARCHITECTURE.md`
- `docs/API_SPEC.md`
- `docs/LEDGER_INTEGRATION.md`
- `docs/SECURITY_OPERATIONS.md`
- `docs/METHODOLOGY.md`
- `docs/SPRINT_PLAN.md`

When documents conflict, `CURRENT_BASELINE.md` and accepted decisions in
`DESIGN_DECISIONS.md` take precedence. Update the canonical documents in the same
pull request as an accepted behavior change.

## MVP Boundary

- Sendaza Core is the only authenticated MVP client.
- Customer frontends never call SLE directly.
- External client onboarding and public partner APIs are deferred.
- Assets, fiat currencies, networks, markets, pricing routes, and providers are
  configuration-driven.
- ETH, NGN, Ethereum, and Sepolia are examples or initial configurations, not
  hardcoded domain assumptions.
- Asset and network are separate dimensions. For example, USDT on Ethereum and
  USDT on Tron have separate custody routes, fees, wallets, and inventory.
- The MVP is a modular NestJS application, not a collection of microservices.
- The API and worker are separate processes built from the same repository.

## Non-Negotiable Financial Invariants

- Never use JavaScript `Number`, floating-point arithmetic, `parseFloat`, or
  implicit numeric coercion for money, rates, fees, or asset quantities.
- Use atomic-unit `bigint` values in domain logic. Use `decimal.js` only at
  reviewed rate and conversion boundaries.
- Monetary API values are decimal strings, never JSON numbers.
- Reject excess precision. Do not silently round customer principal.
- SLE never writes Sendaza customer balances or ledger entries.
- Every financial mutation requires idempotency and a stored request hash.
- Reusing an idempotency key with a different request returns a conflict.
- A quote is not a purchase and does not reserve inventory.
- Inventory reservation is atomic and cannot make sellable inventory negative.
- Holdings on one network cannot back a withdrawal on another network until an
  explicit, confirmed, and reconciled rebalance completes.
- A timeout after provider submission is not proof of failure.
- A broadcast transaction is not a confirmed transaction.
- Release a Sendaza lock automatically only after failure before broadcast is
  proven. Uncertain outcomes remain locked and enter reconciliation.
- Completed financial records are immutable. Corrections use linked compensating
  records rather than edits or deletion.
- Financial state and its outbound event commit in the same PostgreSQL transaction.

## Custody and Secrets

- Fireblocks MPC is the only blockchain-signing design.
- Never implement a raw private-key signer.
- Never store, load, accept, log, or return treasury private keys, seed phrases,
  or exportable wallet signing material.
- Fireblocks API authentication keys are provider credentials, not treasury keys;
  they still belong only in encrypted environment configuration.
- Never commit populated `.env` files, credentials, tokens, webhook secrets,
  database URLs, or provider payloads containing secrets.
- Source control contains `.env.example` with placeholders only.
- Redact authorization headers, signatures, customer PII, and sensitive provider
  fields from logs and audit payloads.
- A client request cannot select a custody wallet, provider, pricing policy, or
  approval mode.

## Architecture Rules

- Prefer domain modules and explicit interfaces over vendor SDK usage in
  application services.
- Keep provider SDKs inside adapters implementing domain-owned interfaces.
- PostgreSQL is authoritative for financial state, jobs, idempotency, outbox,
  reconciliation, and audit records.
- Process memory, caches, and logs are never financial truth.
- Workers claim bounded batches using leases and `FOR UPDATE SKIP LOCKED` or an
  equivalent proven PostgreSQL mechanism.
- Design every job so it is safe to retry after a process crash.
- Keep HTTP controllers thin. Validation and orchestration belong in application
  services; invariants belong in the domain.
- Do not query another module's tables directly when an established module
  interface exists.
- Avoid new abstractions until they remove real duplication, enforce a boundary,
  or match an established project pattern.
- Avoid Redis, Kafka, Kubernetes, and additional deployment units until measured
  requirements justify them.

## Planned Repository Structure

```text
apps/
  api/
  worker/
packages/
  domain/
  database/
  contracts/
  configuration/
  observability/
  testing/
prisma/
docs/
```

Use one `pnpm-lock.yaml` and one `pnpm-workspace.yaml`. Do not add
`package-lock.json`, `yarn.lock`, or another package manager's workspace files.

## Toolchain

- Node.js 24 LTS
- pnpm with a repository-pinned version
- TypeScript strict mode
- NestJS
- PostgreSQL and Prisma
- Jest, Supertest, and real PostgreSQL integration tests
- Pino structured logging
- OpenTelemetry instrumentation
- GitHub Actions
- Railway sandbox deployment

Planned root commands after Sprint 0 scaffolding:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm start:api
pnpm start:worker
```

Until a command exists, do not document it as working. When adding or changing a
command, update this file, the root README, and CI together.

## Local Development Without Docker

- Local Docker is optional during early development.
- Run Node.js processes directly and connect to a dedicated local or Railway
  development PostgreSQL database.
- Tests use a separately named test database through `TEST_DATABASE_URL`.
- Test setup must refuse to reset a database unless it is explicitly identified
  as a test database.
- GitHub Actions provides the canonical real-PostgreSQL integration environment.
- Add and verify the production-like container build before the end-to-end
  integration and pilot gates.

## Testing Requirements

Test depth scales with financial risk. A financial state change normally requires:

- Focused unit tests for exact calculations and domain transitions
- Real PostgreSQL integration tests for transactions and constraints
- Idempotency tests
- Relevant concurrency tests
- Provider timeout and ambiguous-result tests
- Contract tests for Sendaza and provider boundaries
- Reconciliation assertions
- Audit and outbox assertions

Mocks alone are insufficient for transaction isolation, locking, unique
constraints, migrations, or concurrent reservation behavior.

Required high-risk scenarios include:

- Concurrent purchase oversell attempts
- Reused idempotency keys with different bodies
- Quote expiry and configuration changes
- Stale, deviating, or missing pricing legs
- Stale network-fee snapshots
- Duplicate Fireblocks submissions
- Timeout before and after provider acceptance
- Duplicate, forged, delayed, reordered, and missing webhooks
- Broadcast, replacement, confirmation, and on-chain failure
- Sendaza/SLE restart at every external transition
- Treasury/liability variance and circuit-breaker activation

Do not weaken or skip a failing financial test to make CI pass. Fix the behavior
or document and obtain approval for a changed requirement.

## Database and Migration Rules

- Use forward Prisma migrations. Do not edit an applied migration.
- Review generated SQL before committing it.
- Add database constraints for invariants that PostgreSQL can enforce.
- Include migration and rollback/forward-recovery considerations in the PR.
- Never run destructive development reset commands against a shared, sandbox,
  staging, or production database.
- Database changes affecting amounts, status, idempotency, or reconciliation need
  pre/post-migration verification.

## API and Event Rules

- Use OpenAPI 3.1 and JSON Schema for Sendaza-facing contracts.
- Maintain stable machine-readable error codes.
- Mutations require `Idempotency-Key` and `X-Correlation-Id`.
- Validate unknown fields, unsupported assets/networks, malformed decimal strings,
  and excess precision.
- Sign exact raw webhook bodies with timestamp and replay protection.
- Persist inbound financial events before acknowledging them.
- Delivery is at least once; consumers must be idempotent by event ID.
- Breaking contract changes require an ADR, migration plan, and Sendaza approval.

## Observability and Operations

- Carry `correlation_id`, aggregate ID, and safe provider reference through logs,
  traces, events, and provider calls.
- Add metrics for state age, job backlog, provider errors, fee/rate freshness,
  inventory, gas reserves, and reconciliation variance.
- Every circuit breaker must expose its reason, affected scope, activation time,
  and recovery conditions.
- Manual actions must be authenticated, authorized, audited, and idempotent.
- Operations cannot arbitrarily edit customer balances or completed financial
  history.

## Documentation Method

Substantial modules use:

```text
docs/modules/<module-name>/MODULE.md
```

Follow `docs/METHODOLOGY.md` for required sections, Definition of Ready,
Definition of Done, reviewers, and release gates. Avoid empty template documents.

Use an ADR for decisions affecting multiple modules, financial invariants,
custody, customer debit, API compatibility, data migration, or reconciliation.

## Git and GitHub Workflow

- `main` is the protected default branch.
- Work from short-lived branches named `feature/...`, `fix/...`, `docs/...`,
  `test/...`, or `chore/...`.
- One pull request should implement one story or a tightly related increment.
- Use Conventional Commit-style subjects with a meaningful scope.
- Commit coherent, reviewable increments that leave the branch valid.
- Do not create empty commits, trivial line-by-line commits, backdated commits, or
  generated churn for contribution farming.
- Preserve useful commits and squash noisy fixups before merge.
- Never rewrite shared `main` history or force-push it.
- Never commit unrelated files merely because they are present in the workspace.

Examples:

```text
feat(quotes): add versioned conversion routes
fix(withdrawals): preserve lock after provider timeout
test(treasury): cover concurrent inventory reservations
docs(custody): define Fireblocks recovery behavior
chore(ci): run PostgreSQL contract tests
```

Pull requests include outcome, financial/security impact, schema or contract
changes, tests, failure evidence, documentation, recovery considerations, and
release-gate impact.

## Completion Standard

Do not call work complete merely because code compiles. It must meet the
Definition of Done in `docs/METHODOLOGY.md`, pass the relevant sprint gate in
`docs/SPRINT_PLAN.md`, and leave code, contracts, documentation, tests, and
operations consistent.
