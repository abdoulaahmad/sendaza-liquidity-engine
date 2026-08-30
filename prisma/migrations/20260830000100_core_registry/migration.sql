CREATE TYPE "RegistryStatus" AS ENUM ('ENABLED', 'DISABLED');
CREATE TYPE "AssetKind" AS ENUM ('NATIVE', 'TOKEN');

CREATE TABLE "assets" (
  "id" UUID PRIMARY KEY,
  "symbol" VARCHAR(20) NOT NULL UNIQUE,
  "name" VARCHAR(100) NOT NULL,
  "kind" "AssetKind" NOT NULL,
  "decimals" INTEGER NOT NULL CHECK ("decimals" BETWEEN 0 AND 255),
  "status" "RegistryStatus" NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "fiat_currencies" (
  "id" UUID PRIMARY KEY,
  "code" VARCHAR(3) NOT NULL UNIQUE,
  "name" VARCHAR(100) NOT NULL,
  "decimals" INTEGER NOT NULL CHECK ("decimals" BETWEEN 0 AND 18),
  "status" "RegistryStatus" NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "networks" (
  "id" UUID PRIMARY KEY,
  "code" VARCHAR(30) NOT NULL UNIQUE,
  "name" VARCHAR(100) NOT NULL,
  "native_asset_id" UUID NOT NULL REFERENCES "assets"("id"),
  "address_family" VARCHAR(30) NOT NULL,
  "required_confirmations" INTEGER NOT NULL CHECK ("required_confirmations" >= 0),
  "status" "RegistryStatus" NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "asset_networks" (
  "id" UUID PRIMARY KEY,
  "asset_id" UUID NOT NULL REFERENCES "assets"("id"),
  "network_id" UUID NOT NULL REFERENCES "networks"("id"),
  "token_standard" VARCHAR(30) NOT NULL,
  "contract_address" VARCHAR(255),
  "network_decimals" INTEGER NOT NULL CHECK ("network_decimals" BETWEEN 0 AND 255),
  "provider_asset_code" VARCHAR(100),
  "deposits_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "withdrawals_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "min_withdrawal_atomic" BIGINT,
  "max_withdrawal_atomic" BIGINT,
  "status" "RegistryStatus" NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_networks_asset_id_network_id_key" UNIQUE ("asset_id", "network_id"),
  CONSTRAINT "asset_network_withdrawal_limits_check" CHECK (
    "min_withdrawal_atomic" IS NULL OR "max_withdrawal_atomic" IS NULL
    OR "min_withdrawal_atomic" <= "max_withdrawal_atomic"
  )
);

CREATE TABLE "configuration_versions" (
  "id" SERIAL PRIMARY KEY,
  "description" VARCHAR(255) NOT NULL,
  "actor_id" VARCHAR(100) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "markets" (
  "id" UUID PRIMARY KEY,
  "base_asset_id" UUID NOT NULL REFERENCES "assets"("id"),
  "quote_fiat_id" UUID NOT NULL REFERENCES "fiat_currencies"("id"),
  "default_backing_asset_network_id" UUID NOT NULL REFERENCES "asset_networks"("id"),
  "spread_bps" INTEGER NOT NULL DEFAULT 0 CHECK ("spread_bps" BETWEEN 0 AND 10000),
  "fixed_fee_atomic" BIGINT NOT NULL DEFAULT 0 CHECK ("fixed_fee_atomic" >= 0),
  "min_order_atomic" BIGINT NOT NULL CHECK ("min_order_atomic" >= 0),
  "max_order_atomic" BIGINT NOT NULL CHECK ("max_order_atomic" >= "min_order_atomic"),
  "quote_ttl_seconds" INTEGER NOT NULL CHECK ("quote_ttl_seconds" > 0),
  "status" "RegistryStatus" NOT NULL DEFAULT 'ENABLED',
  "configuration_version_id" INTEGER NOT NULL REFERENCES "configuration_versions"("id"),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "markets_base_asset_id_quote_fiat_id_key" UNIQUE ("base_asset_id", "quote_fiat_id")
);

CREATE TABLE "configuration_audit_logs" (
  "id" UUID PRIMARY KEY,
  "configuration_version" INTEGER NOT NULL,
  "actor_id" VARCHAR(100) NOT NULL,
  "action" VARCHAR(50) NOT NULL,
  "resource_type" VARCHAR(50) NOT NULL,
  "resource_id" VARCHAR(100) NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "configuration_audit_logs_resource_type_resource_id_created_at_idx"
  ON "configuration_audit_logs" ("resource_type", "resource_id", "created_at");

INSERT INTO "assets" ("id", "symbol", "name", "kind", "decimals") VALUES
  ('00000000-0000-4000-8000-000000000001', 'ETH', 'Ether', 'NATIVE', 18),
  ('00000000-0000-4000-8000-000000000002', 'SOL', 'Solana', 'NATIVE', 9),
  ('00000000-0000-4000-8000-000000000003', 'USDT', 'Tether USD', 'TOKEN', 6);
INSERT INTO "fiat_currencies" ("id", "code", "name", "decimals")
  VALUES ('00000000-0000-4000-8000-000000000004', 'NGN', 'Nigerian Naira', 2);
INSERT INTO "networks" ("id", "code", "name", "native_asset_id", "address_family", "required_confirmations") VALUES
  ('00000000-0000-4000-8000-000000000005', 'ETHEREUM', 'Ethereum', '00000000-0000-4000-8000-000000000001', 'EVM', 12),
  ('00000000-0000-4000-8000-000000000006', 'SOLANA', 'Solana', '00000000-0000-4000-8000-000000000002', 'SOLANA', 32);
INSERT INTO "asset_networks" (
  "id", "asset_id", "network_id", "token_standard", "contract_address",
  "network_decimals", "provider_asset_code", "deposits_enabled", "withdrawals_enabled"
) VALUES
  ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005', 'ERC20', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 'USDT_ETH', TRUE, TRUE),
  ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000006', 'SPL', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6, 'USDT_SOL', TRUE, TRUE);
INSERT INTO "configuration_versions" ("id", "description", "actor_id")
  VALUES (1, 'Initial illustrative USDT/NGN registry', 'system:migration');
SELECT setval(pg_get_serial_sequence('configuration_versions', 'id'), 1, TRUE);
INSERT INTO "markets" (
  "id", "base_asset_id", "quote_fiat_id", "default_backing_asset_network_id",
  "spread_bps", "fixed_fee_atomic", "min_order_atomic", "max_order_atomic",
  "quote_ttl_seconds", "configuration_version_id"
) VALUES (
  '00000000-0000-4000-8000-000000000009',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000007',
  100, 0, 100000, 500000000, 15, 1
);
