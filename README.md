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
