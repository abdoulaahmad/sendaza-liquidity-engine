# SLE Current Design Baseline

This index identifies the canonical decisions for the Sendaza-only, free-first MVP.

## Canonical Decisions

1. SLE is a private service for Sendaza Core in the MVP; external client onboarding is deferred.
2. Sendaza Core calls SLE; customer frontends never call SLE directly.
3. SLE has no customer-facing frontend.
4. The free MVP has no graphical SLE operations console.
5. A restricted operations console is introduced only after core workflows are validated.
6. The MVP uses Railway API and worker services, Railway PostgreSQL, Alchemy
   Sepolia, and an MPC custody-provider sandbox.
7. The free MVP cannot hold real customer funds or mainnet keys.
8. SLE owns configurable crypto/fiat pricing routes, spreads, purchase fees, executable quotes, treasury reservations, MPC custody, and withdrawals.
9. Assets, fiat currencies, networks, markets, and providers remain configuration-driven; ETH and NGN are examples, not hardcoded scope.

## Canonical Documents

| Document | Authority |
| --- | --- |
| [DESIGN_DECISIONS.md](./DESIGN_DECISIONS.md) | Decision precedence and terminology |
| [MULTI_CLIENT_DESIGN.md](./MULTI_CLIENT_DESIGN.md) | Deferred post-MVP platform design |
| [FRONTEND_BOUNDARY.md](./FRONTEND_BOUNDARY.md) | Customer experience and operations-console ownership |
| [TECH_STACK_MVP.md](./TECH_STACK_MVP.md) | Free-first testnet stack |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Core components and state machines |
| [API_SPEC.md](./API_SPEC.md) | Initial endpoint and event contracts |
| [LEDGER_INTEGRATION.md](./LEDGER_INTEGRATION.md) | Sendaza ledger integration example |
| [SECURITY_OPERATIONS.md](./SECURITY_OPERATIONS.md) | Security, treasury, and operations controls |
| [ROADMAP.md](./ROADMAP.md) | Delivery phases |
| [METHODOLOGY.md](./METHODOLOGY.md) | Canonical delivery methodology and release gates |
| [SPRINT_PLAN.md](./SPRINT_PLAN.md) | Canonical two-week sprint sequence and demonstrations |
| [SENDAZA_ENGINEERING_HANDOFF.md](./SENDAZA_ENGINEERING_HANDOFF.md) | Sendaza integration ownership, required changes, and readiness checklist |

## Terminology Corrections

MVP APIs are authenticated for Sendaza only. Generic domain identifiers remain
useful internally, but the implementation does not require tenant isolation,
partner onboarding, per-client pools, or client-selected configuration.

## Frontend Summary

```text
Customer frontend: owned by Sendaza
Sendaza Core: authenticates customers and calls SLE
SLE API: private B2B execution interface
SLE operations console: deferred internal tool
```
