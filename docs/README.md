# Sendaza Liquidity Engine Design Package

**Product name:** Sendaza Liquidity Engine  
**Abbreviation:** SLE  
**Document status:** MVP design baseline  
**Initial integration:** Sendaza-only sandbox with configuration-driven markets  

## Purpose

The Sendaza Liquidity Engine is a private service that supplies executable crypto purchase quotes, manages prefunded crypto treasury inventory, and settles approved withdrawals to external blockchain addresses.

SLE owns market-data conversion routes, spreads, purchase fees, and immutable
quote economics. ETH/NGN may be used as an initial test configuration, but assets,
fiat currencies, networks, and markets are not hardcoded.

The MVP has exactly two user-facing capabilities:

1. Buy a supported crypto asset using a supported fiat balance held in Sendaza.
2. Send an internally held crypto asset to an external address on a supported network.

All customer identity, KYC, authentication, fiat funding, internal balances, and double-entry accounting remain in Sendaza Core.

## Documents

| Document | Purpose |
| --- | --- |
| [FEASIBILITY.md](./FEASIBILITY.md) | Business, technical, operational, and regulatory feasibility |
| [PRD.md](./PRD.md) | MVP scope, requirements, user journeys, and acceptance criteria |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Service boundaries, components, state machines, and data model |
| [API_SPEC.md](./API_SPEC.md) | Sendaza-to-SLE REST and webhook contracts |
| [LEDGER_INTEGRATION.md](./LEDGER_INTEGRATION.md) | Sendaza accounting entries and cross-service settlement protocol |
| [SECURITY_OPERATIONS.md](./SECURITY_OPERATIONS.md) | Security controls, treasury operations, reconciliation, and incidents |
| [ROADMAP.md](./ROADMAP.md) | Phased implementation and launch gates |
| [METHODOLOGY.md](./METHODOLOGY.md) | Modular Agile delivery, GitHub workflow, definitions, and safety gates |
| [SPRINT_PLAN.md](./SPRINT_PLAN.md) | Twelve-sprint MVP execution plan and GitHub milestones |

## Non-Negotiable Boundaries

- SLE never directly modifies a customer's Sendaza balance.
- Sendaza never stores or handles treasury private keys.
- Monetary amounts cross APIs as decimal strings, never JSON numbers.
- Every mutation requires a unique idempotency key.
- A purchase quote is not a completed purchase.
- A broadcast withdrawal is not a confirmed withdrawal.
- Asset, network, fiat, market, and provider behavior is configuration-driven.
- ETH and NGN are initial configurations, not hardcoded system assumptions.
- The MVP accepts only authenticated Sendaza service calls; external client onboarding is deferred.

## MVP Context

```text
Sendaza Mobile/Admin
        |
        v
Sendaza Core API + Customer Ledger
        |
        | authenticated service API and signed webhooks
        v
Sendaza Liquidity Engine
        |
        +--> Market Price Provider(s)
        +--> Custody/Signing Provider
        +--> Blockchain RPC/Indexer
```
