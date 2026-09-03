# Sendaza Liquidity Engine

Private Sendaza-only pricing, treasury, custody, and withdrawal service.

## Development Commands

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

Unit tests do not require PostgreSQL. Integration tests require
`TEST_DATABASE_URL`; the database name must contain `test` or the harness exits
without connecting. Apply migrations to the test database before running the
integration suite.

`pnpm test:integration` discovers each `*.integration.spec.ts` file and runs it
in a separate Jest process so a failed PostgreSQL connection pool cannot affect
later suites. Each suite is limited to 180 seconds by default. Override this
with `SLE_INTEGRATION_SUITE_TIMEOUT_MS` when a known remote test database is
slower; accepted values are 1,000 through 3,600,000 milliseconds.
