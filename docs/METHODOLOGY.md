# SLE Risk-Driven Modular Delivery Methodology

**Status:** Canonical delivery methodology  
**Applies to:** Sendaza-only SLE MVP and production-readiness work

## 1. Method

SLE uses specification-first Agile delivery organized by modules, implemented in
short vertical iterations, and controlled by mandatory financial, security, and
reconciliation gates.

```text
Architecture baseline
  -> module specification
  -> vertical sprint delivery
  -> failure and concurrency verification
  -> module acceptance gate
  -> integrated sandbox release
  -> production-readiness gate
```

Sprint completion does not by itself approve a financial module or release.

## 2. Principles

1. Specify financial contracts before implementation.
2. Deliver working vertical capabilities in short iterations.
3. Treat failure, ambiguity, concurrency, and recovery as normal requirements.
4. Require explicit safety evidence before advancing a release.
5. Keep domain modules independent without prematurely splitting deployments.
6. Update canonical documentation with every accepted behavior change.

## 3. Architecture Baseline

The following invariants apply to every module:

- Sendaza is the only authenticated MVP client.
- Customer frontends never call SLE directly.
- SLE cannot write Sendaza customer balances.
- Sendaza cannot access treasury signing material.
- Monetary API values are decimal strings; domain amounts use exact arithmetic.
- Assets, fiat currencies, networks, markets, and providers are configuration-driven.
- Asset and network are separate dimensions.
- Every financial mutation is idempotent.
- Financial state and its outbound event commit atomically through an outbox.
- A timeout after provider submission is not proof of failure.
- Broadcast is not confirmation.
- Completed financial history is immutable; corrections use compensating records.
- Treasury holdings and Sendaza liabilities must be independently reconcilable.

Changing an invariant requires an accepted architecture decision record and an
impact review covering APIs, data, security, accounting, tests, and operations.

## 4. Delivery Areas

### Core Platform

- Sendaza service authentication
- Exact monetary amount library
- Asset, network, fiat, market, and provider configuration
- Idempotency and replay protection
- Audit logging
- Transactional outbox and workers

### Pricing and Purchase

- Market-data adapters
- Conversion routes and stablecoin reference handling
- Spreads and purchase fees
- Immutable executable quotes
- Treasury availability and inventory reservations
- Sendaza lock and settlement handshake

### Treasury and Custody

- Fireblocks MPC adapter
- Treasury wallet registry and balance synchronization
- Asset-network inventory
- Native gas reserves
- Funding and replenishment evidence
- Custody policy and approval status

### Withdrawals

- Cached asset-network fee snapshots
- Address and network validation
- Withdrawal policy and manual review
- Fireblocks submission
- Provider webhook and polling lifecycle
- Blockchain finality and transaction replacement

### Reconciliation and Operations

- Sendaza liability snapshots
- Holdings and liability reconciliation
- Fee-estimate and actual-fee reconciliation
- Liquidity alerts and circuit breakers
- Incident recovery and replay
- Audit and solvency reporting

The MVP begins as one modular NestJS codebase with independently runnable API,
worker, and reconciliation processes. Module boundaries do not imply separate
microservices.

## 5. Module Specification

Each substantial module has a canonical specification:

```text
docs/modules/<module-name>/MODULE.md
```

The specification contains:

1. Purpose and ownership
2. Scope and exclusions
3. Functional requirements
4. Invariants and acceptance criteria
5. Interfaces, commands, queries, and events
6. Data model and constraints
7. State transitions
8. Security and privacy considerations
9. Failure, retry, and reconciliation behavior
10. Test plan
11. Metrics, alerts, and operational recovery
12. Open decisions and dependencies

Split these sections into separate files only when the module is large or has
independent ownership. Avoid empty documentation created only for a template.

## 6. Work Hierarchy

```text
Product objective
  -> release
  -> delivery area
  -> module or epic
  -> vertical user story
  -> engineering task
```

Stories describe an observable outcome and include failure behavior. Tasks may
cover schema, domain logic, API, worker, provider adapter, tests, telemetry, and
documentation, but the story is accepted only as a working vertical capability.

## 7. Definition of Ready

A financial story may enter implementation when it has:

- A clear outcome, scope, and owner
- Testable acceptance criteria
- Defined monetary units and precision
- API, event, or internal interface contract
- Idempotency and concurrency behavior
- Failure, timeout, retry, and reconciliation behavior
- Security and authorization considerations
- Dependencies and open decisions identified
- A practical test approach

Unresolved details that could change ledger, custody, solvency, or customer debit
behavior block implementation.

## 8. Definition of Done

A story is done when:

- Implementation and review are complete.
- Unit and database integration tests pass.
- Contract and state-transition tests pass.
- Idempotency and relevant concurrency tests pass.
- Provider failures and ambiguous outcomes are covered.
- Audit events, structured logs, metrics, and alerts are present.
- Secrets and sensitive data are excluded from logs and responses.
- Reconciliation impact is implemented or explicitly proven absent.
- API and module documentation reflects the accepted behavior.
- Acceptance criteria are demonstrated in the target environment.

Code completion without this evidence is work in progress.

## 9. Iteration Model

Use two-week sprints for planned delivery:

```text
Day 1       planning and contract confirmation
Days 2-8    implementation, review, and continuous testing
Days 9-10   integration, failure testing, demonstration, and retrospective
```

Each sprint delivers a thin working path. Avoid organizing sprints as all
database work followed by all APIs followed by all tests.

Use a parallel Kanban lane for defects, security findings, provider incidents,
documentation corrections, and operational work. Urgent work entering the
sprint requires an explicit tradeoff rather than hidden scope expansion.

## 10. Reviews and Decisions

Use architecture decision records for choices that affect multiple modules or a
financial invariant. Each decision records context, chosen option, alternatives,
consequences, status, owner, and approval date.

| Area | Required review |
| --- | --- |
| Customer behavior | Product owner and Sendaza integration owner |
| Ledger or settlement | Sendaza engineering and finance owner |
| Treasury or fees | Treasury/finance owner |
| Custody or authentication | Security owner |
| Screening, limits, or manual review | Compliance owner |
| Architecture and release | SLE engineering lead |

One person may hold multiple roles in the sandbox phase. Production approval
requires independent security, treasury, and compliance review.

## 11. Release Gates

### Foundation Gate

- Exact amount conversion is verified for configured assets.
- Duplicate and concurrent mutations cannot duplicate financial effects.
- Authentication, replay protection, audit, and outbox recovery pass.

### Pricing and Purchase Gate

- Quotes are exact, immutable, reproducible, versioned, and time-limited.
- Stale or deviating market data stops quoting.
- Concurrent purchases cannot oversell asset-network inventory.
- Sendaza lock, settlement, rollback, and ambiguity scenarios converge.

### Custody and Withdrawal Gate

- SLE never handles treasury private keys.
- Automatic and manual Fireblocks policy paths are verified.
- Duplicate requests cannot create a second provider submission.
- Provider timeout, webhook duplication, transaction replacement, and finality pass.
- Funds release automatically only after proven failure before broadcast.

### Reconciliation Gate

- Holdings, liabilities, reservations, pending withdrawals, gas, and safety reserves reconcile at a common cutoff.
- Every variance is persisted, classified, and attributable.
- An unexplained shortfall activates the affected circuit breaker.

### Production-Readiness Gate

- No unresolved critical or high financial/security finding exists.
- No unexplained reconciliation variance exists during the pilot window.
- Backup, restore, outbox replay, provider outage, and incident exercises pass.
- Legal, compliance, custody, treasury, operations, and finance approvals exist.

## 12. GitHub Commit-Driven Workflow

Git history is a delivery artifact. Every commit should represent a coherent,
reviewable improvement that leaves the branch in a valid state. Commit frequency
should emerge from incremental delivery, not empty commits or artificial file
churn.

### Repository setup

- Host SLE in a standalone GitHub repository rather than a fork.
- Use `main` as the protected default branch.
- Configure the Git author email to an email associated with the contributor's
  GitHub account, or use the GitHub-provided no-reply address.
- Require pull requests and passing checks before merging to `main`.
- Enable private-contribution visibility on the GitHub profile when the
  repository is private and contribution visibility is desired.

Commits on feature branches contribute to the profile after they are merged into
the default branch under GitHub's contribution rules.

### Sprint contribution target

Each sprint targets at least 30 meaningful GitHub contributions. The target is
met through real delivery activity such as:

- Focused implementation, test, migration, documentation, and tooling commits
- Backlog issues with acceptance criteria and completion evidence
- Pull requests for independently reviewable increments
- Reviews and follow-up changes that improve correctness
- Architecture decisions and operational runbooks

Use merge commits or rebase-and-merge when the feature branch contains useful,
coherent commits. Do not squash an entire sprint into one commit. No sprint is
accepted based on contribution count alone: its tests and stated gate must also
pass.

### Branches

Create one short-lived branch for one story, defect, decision, or documentation
change:

```text
feature/quote-expiry
feature/fireblocks-submission
fix/idempotency-race
docs/withdrawal-state-machine
test/provider-timeout
chore/ci-contract-checks
```

Branches should normally live for less than one sprint. Large work is split into
independently mergeable vertical increments rather than a long-running feature
branch.

### Commit standard

Use Conventional Commit-style subjects:

```text
feat(quotes): add versioned conversion-route evaluation
feat(treasury): reserve asset-network inventory atomically
fix(withdrawals): preserve lock after provider timeout
test(custody): cover duplicate Fireblocks submission
docs(pricing): define stablecoin depeg handling
refactor(amounts): centralize atomic-unit conversion
chore(ci): run contract tests on pull requests
```

Allowed primary types are:

| Type | Purpose |
| --- | --- |
| `feat` | New product or operational behavior |
| `fix` | Defect correction |
| `test` | Test behavior or coverage |
| `docs` | Design, contract, or operational documentation |
| `refactor` | Internal restructuring without behavioral change |
| `perf` | Measured performance improvement |
| `chore` | Tooling, dependency, CI, or maintenance work |
| `security` | Security control or validated remediation |

Commit bodies explain why the change exists, financial or operational impact,
important alternatives, migrations, and test evidence when the subject alone is
insufficient.

### Commit boundaries

Make a commit when a coherent increment is complete, for example:

- A module requirement or ADR is reviewed and internally consistent.
- A schema migration and its constraints are complete.
- A domain rule is implemented with focused unit tests.
- An API contract and validation are complete.
- A provider adapter capability works against a deterministic fake.
- A failure or concurrency test reproduces and verifies one scenario.
- Metrics, alerts, or recovery procedures for one behavior are complete.

Do not create:

- Empty commits solely to color the contribution graph
- One commit per trivial line or spelling change
- Commits that knowingly leave the branch uncompilable
- Mixed commits containing unrelated modules or refactors
- Backdated commits or rewritten author data for contribution farming
- Generated artifacts without their source or reason

### Pull requests

Each pull request maps to one backlog story or tightly related group and includes:

1. Outcome and scope
2. Financial, security, and reconciliation impact
3. API, schema, or configuration changes
4. Test and failure-injection evidence
5. Documentation updated
6. Rollback or forward-recovery considerations
7. Release-gate impact

Prefer several focused commits when they represent meaningful review steps, such
as contract, implementation, failure tests, and operations. Squashing is optional:
preserve useful commits; squash noisy fixups before merge.

### Daily cadence

A productive development day should normally end with one or more meaningful
commits pushed to a story branch when coherent work has been completed. It is
acceptable to have no commit when work is exploratory, blocked, or not yet in a
valid state.

Suggested cadence:

```text
Specify or refine one vertical increment
  -> implement the smallest coherent behavior
  -> add focused tests
  -> commit with a meaningful subject
  -> push and open/update the pull request
  -> merge after checks and required review
```

Contribution count is a side effect of sustained, traceable delivery. Quality,
reviewability, and financial correctness take precedence over commit volume.

## 13. Reporting

Each sprint reports accepted vertical capabilities, acceptance evidence, open
risks and decisions, failed or deferred tests, financial or reconciliation
impact, and release-gate progress.

Progress is measured by accepted capabilities and gate evidence, not story points
or percentage-complete estimates alone.

## 14. Change Control

Requirements may evolve through the product backlog. A change that affects
financial invariants, custody, customer debit, API compatibility, data migration,
or reconciliation requires:

1. Impact analysis
2. Updated module specification
3. An ADR when cross-module or architectural
4. Reviewer approval
5. Updated tests and operational procedures

Emergency fixes follow the same evidence requirements after immediate containment.

A change to the verification mechanism itself (for example, CI becoming
unavailable) does not relax any requirement in this document. It requires the
same impact analysis and an ADR recording the accepted temporary substitute
evidence and the condition that supersedes it. See
[ADR-013](./DESIGN_DECISIONS.md#adr-013-temporary-local-verification-substitutes-for-blocked-github-actions-ci)
for the current GitHub Actions billing block and its accepted local-verification
substitute.
