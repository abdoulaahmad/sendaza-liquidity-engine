# Sendaza Liquidity Engine Feasibility Study

**Status:** Conditional go  
**Scope:** Crypto purchase and external crypto withdrawal  
**Illustrative configuration:** ETH on Ethereum, purchased with NGN  

## 1. Executive Decision

The MVP is technically feasible using a prefunded custodial treasury and an internal customer ledger. It fits the existing Sendaza modular architecture and avoids an on-chain transaction for every purchase.

The recommendation is **GO WITH CONDITIONS**. Development may proceed after the product boundary is approved, but production launch must not occur until custody, liquidity, compliance, and licensing gates are satisfied.

## 2. Proposed Operating Model

Sendaza acts as the customer system of record. SLE acts as the crypto execution and treasury system.

### Purchase

1. Sendaza requests a short-lived quote from SLE.
2. SLE prices the market and verifies sellable treasury inventory.
3. Sendaza locks the customer's fiat amount.
4. Sendaza submits the accepted quote to SLE.
5. SLE reserves and allocates treasury crypto.
6. Sendaza atomically settles fiat and crypto ledger entries.

The blockchain treasury balance does not change during an internal purchase. User crypto liabilities increase and unallocated treasury inventory decreases.

### External withdrawal

1. Sendaza validates the customer, balance, limits, PIN, and KYC status.
2. Sendaza locks the crypto amount and fees.
3. SLE validates policy and submits the transfer to the custody provider.
4. SLE monitors the blockchain transaction.
5. SLE sends signed lifecycle events to Sendaza.
6. Sendaza finalizes the deduction only after the defined finality condition.

## 3. Technical Feasibility

| Area | Assessment | Decision |
| --- | --- | --- |
| Pricing | Feasible through replaceable provider adapters | Use primary and fallback sources |
| Inventory | Feasible with prefunded treasury and reservation accounting | Required before accepting purchases |
| Custody | Feasible through MPC/custody provider | Do not self-host keys in MVP |
| Blockchain monitoring | Feasible through provider webhooks plus RPC verification | Never trust one callback alone |
| Sendaza integration | Feasible through service API and transactional outbox | SLE cannot write customer ledger |
| Precision | Feasible with arbitrary precision decimal or atomic units | Existing `NUMERIC(18,4)` is insufficient for crypto |
| Scalability | Stateless API nodes plus PostgreSQL workers are sufficient for MVP | Partition workers by asset/network later |
| Extensibility | Feasible with asset/network/market/provider registries | No ETH-specific business branches |

## 4. Business Feasibility

Revenue can come from a configurable quote spread, explicit service fee, and withdrawal service fee. Network fees should be passed through or transparently subsidized.

The main commercial constraint is working capital. Every customer crypto liability must be backed by controlled treasury holdings. Growth therefore consumes treasury liquidity even when purchases are internal.

Required launch inputs:

- Initial treasury allocations for enabled asset-network routes
- Settlement accounts and liquidity sources for enabled fiat currencies
- Approved spread and fee schedule
- Maximum aggregate exposure per asset
- Daily purchase and withdrawal limits
- Custody and price-provider contracts

## 5. Regulatory Feasibility

SLE facilitates virtual-asset purchase, custody-related treasury operations, transfer, and settlement. In Nigeria, this is likely within the virtual asset service provider perimeter rather than the exemption for a technology provider that only supplies infrastructure.

Production launch therefore requires a formal Nigerian legal and compliance opinion covering:

- Required SEC registration, approval, or incubation route
- Custody structure and whether a third-party custodian changes obligations
- Customer asset disclosures and safeguarding
- AML/CFT, sanctions, transaction monitoring, and suspicious-activity reporting
- Travel Rule applicability for external transfers
- Bank-account and fiat-settlement arrangements
- Tax, consumer protection, privacy, and record-retention obligations

This document is an engineering feasibility assessment, not legal advice.

### Primary regulatory references

- SEC Nigeria's 2022 digital asset rules cover platforms facilitating virtual-asset trading, exchange, transfer, and custody-related services: https://sec.gov.ng/wp-content/uploads/2022/05/Rules-on-Issuance-Offering-and-Custody-of-Digital-Assets.pdf
- CBN's December 2023 guidelines govern banking relationships with VASPs and state that regulated financial institutions may not trade virtual currencies on their own account: https://www.cbn.gov.ng/out/2024/fprd/guidelines%20on%20operations%20of%20bank%20accounts%20for%20virtual%20asset%20providers.pdf
- SEC FinPort describes the ARIP path and operational readiness expectations for VASPs: https://www.sec.gov.ng/fintech-and-innovation-hub-finport/finport-programs-ri-and-arip/
- FATF guidance covers risk-based VASP controls and the Travel Rule: https://www.fatf-gafi.org/en/topics/virtual-assets.html

Regulations are evolving. Applicable rules must be revalidated immediately before launch.

## 6. Principal Risks and Controls

| Risk | Impact | Required control |
| --- | --- | --- |
| Treasury shortfall | Customer assets become undercollateralized | Real-time availability calculation and circuit breaker |
| Price movement | SLE sells crypto below sustainable price | Short quote TTL, spread, and price-deviation guard |
| Key compromise | Treasury loss | MPC custody, policy engine, allowlists, approval quorum |
| Duplicate request | Double allocation or withdrawal | Unique idempotency key and provider reference |
| Partial cross-service failure | One system settles while the other does not | State machines, outbox, callbacks, and reconciliation |
| Wrong network/address | Irrecoverable customer loss | Network-specific validation and explicit confirmation |
| Webhook forgery | False settlement | Signature verification, timestamp window, and replay store |
| Provider outage | Purchases or withdrawals stall | Health-based routing, safe pending states, operational controls |
| Compliance breach | Legal and banking exposure | KYC, limits, screening, case management, and audit trail |

## 7. Go/No-Go Gates

### Engineering go

- Approved architecture and API contracts
- Crypto-capable Sendaza ledger precision
- Custody sandbox integration
- Deterministic reconciliation design
- Failure-injection tests for every external transition

### Production go

- Written legal/compliance approval
- Approved custody and liquidity arrangements
- Treasury funding and proof-of-control ceremony
- Security assessment and penetration test
- Disaster recovery exercise
- Reconciliation operates cleanly during a controlled pilot
- Finance and operations sign off on solvency reports

## 8. Recommendation

Build one configured crypto/fiat market first, with manual treasury replenishment
and one custody provider. The first sandbox configuration may be ETH/NGN, but
the implementation must remain generic across assets, networks, fiat currencies,
markets, and pricing routes. Activate additional configurations only after the
first market completes a controlled pilot.
