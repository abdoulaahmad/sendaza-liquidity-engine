# Custody Module

## MPC-Only Rule

Fireblocks MPC is the only blockchain-signing design. SLE never generates,
imports, reconstructs, stores, logs, or returns a treasury private key or seed
phrase. Fireblocks holds distributed MPC key shares and applies its own workspace
transaction policies.

The Fireblocks RSA API private key is different: it authenticates SLE API
requests. It is a deployment secret, never a database field or source-controlled
value, and does not allow SLE to export the treasury wallet signing key.

## Provider Interface

Application services depend on the domain-owned `CustodyProvider` interface.
The Fireblocks and deterministic fake implementations remain worker adapters.
The Sprint 5 read-only method returns:

- decimal-string total, available, pending, frozen, and locked balances;
- registered public addresses and optional tags;
- observation time and a safe provider reference.

Withdrawal creation and signing are deliberately deferred to Sprint 8.

## Fireblocks Authentication and Reads

Every request carries `X-API-Key` and a short-lived RS256 JWT containing the
exact URI, unique nonce, issue/expiry times, subject API key, and SHA-256 body
hash. Sprint 5 reads the configured vault account asset and its paginated
addresses. It never enumerates wallets to guess a match.

References:

- [Fireblocks request authentication](https://developers.fireblocks.com/reference/signing-a-request-jwt-structure)
- [Fireblocks vault asset wallets](https://developers.fireblocks.com/api-reference/vaults/get-vault-wallets-paginated)
- [Fireblocks paginated vault addresses](https://developers.fireblocks.com/api-reference/vaults/get-addresses-paginated)

## Secrets and Configuration

Deployment environment only:

```text
FIREBLOCKS_API_KEY
FIREBLOCKS_API_PRIVATE_KEY
FIREBLOCKS_BASE_URL
SLE_CHAIN_RPC_URLS_JSON
```

The base URL must be HTTPS under `fireblocks.io`. RPC URLs must be HTTPS. Logs
must redact authorization headers, JWTs, private API keys, RPC credentials, and
raw provider errors. Production and sandbox credentials and workspaces must be
isolated.

## Independent Verification

The initial network adapter verifies EVM native balances using
`eth_getBalance` and ERC-20 balances using `balanceOf` through `eth_call`.
Public addresses and contract addresses are sufficient; the adapter receives no
signing material. Additional network families require adapters before their
wallets can be marked verification-required and enabled.

## Known Operational Limitation

No Fireblocks sandbox credential or funded vault is committed to the repository.
Automated tests use generated API authentication keys and deterministic provider
responses. A live funded-wallet demonstration requires deployment-managed
Fireblocks sandbox credentials, a configured enabled wallet, a chain RPC URL,
and testnet faucet funds.

