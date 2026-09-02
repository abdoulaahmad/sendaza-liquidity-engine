CREATE TYPE "CustodyProviderType" AS ENUM ('FIREBLOCKS', 'DETERMINISTIC_FAKE');
CREATE TYPE "TreasuryWalletRole" AS ENUM ('PRIMARY', 'GAS');
CREATE TYPE "TreasuryVerificationStatus" AS ENUM ('MATCHED', 'UNVERIFIED', 'MISMATCH', 'STALE');
CREATE TYPE "TreasurySyncJobStatus" AS ENUM ('PENDING', 'LEASED');
CREATE TYPE "FundingIntentStatus" AS ENUM ('CREATED', 'OBSERVED', 'CONFIRMED', 'CANCELLED');

CREATE TABLE "custody_providers" (
  "id" UUID NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "type" "CustodyProviderType" NOT NULL,
  "status" "RegistryStatus" NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "custody_providers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custody_providers_code_key" UNIQUE ("code")
);

CREATE TABLE "treasury_wallets" (
  "id" UUID NOT NULL,
  "asset_network_id" UUID NOT NULL REFERENCES "asset_networks"("id") ON DELETE RESTRICT,
  "custody_provider_id" UUID NOT NULL REFERENCES "custody_providers"("id") ON DELETE RESTRICT,
  "provider_vault_id" VARCHAR(100) NOT NULL,
  "provider_asset_id" VARCHAR(100) NOT NULL,
  "public_address" VARCHAR(255) NOT NULL,
  "address_tag" VARCHAR(100),
  "role" "TreasuryWalletRole" NOT NULL DEFAULT 'PRIMARY',
  "verification_required" BOOLEAN NOT NULL DEFAULT true,
  "safety_buffer_atomic" BIGINT NOT NULL DEFAULT 0,
  "gas_reserve_atomic" BIGINT NOT NULL DEFAULT 0,
  "stale_after_seconds" INTEGER NOT NULL DEFAULT 60,
  "status" "RegistryStatus" NOT NULL DEFAULT 'DISABLED',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "treasury_wallets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_wallets_provider_wallet_key" UNIQUE ("custody_provider_id", "provider_vault_id", "provider_asset_id"),
  CONSTRAINT "treasury_wallets_reserves_check" CHECK ("safety_buffer_atomic" >= 0 AND "gas_reserve_atomic" >= 0),
  CONSTRAINT "treasury_wallets_stale_check" CHECK ("stale_after_seconds" BETWEEN 1 AND 3600),
  CONSTRAINT "treasury_wallets_address_check" CHECK (length(trim("public_address")) > 0)
);
CREATE INDEX "treasury_wallets_asset_network_status_idx" ON "treasury_wallets" ("asset_network_id", "status");
CREATE UNIQUE INDEX "treasury_wallets_one_active_primary_key" ON "treasury_wallets" ("asset_network_id") WHERE "status" = 'ENABLED' AND "role" = 'PRIMARY';

CREATE TABLE "treasury_snapshots" (
  "id" UUID NOT NULL,
  "treasury_wallet_id" UUID NOT NULL REFERENCES "treasury_wallets"("id") ON DELETE RESTRICT,
  "asset_network_id" UUID NOT NULL REFERENCES "asset_networks"("id") ON DELETE RESTRICT,
  "controlled_atomic" BIGINT NOT NULL,
  "provider_available_atomic" BIGINT NOT NULL,
  "pending_atomic" BIGINT NOT NULL,
  "frozen_atomic" BIGINT NOT NULL,
  "locked_atomic" BIGINT NOT NULL,
  "chain_confirmed_atomic" BIGINT,
  "reserved_atomic" BIGINT NOT NULL,
  "safety_buffer_atomic" BIGINT NOT NULL,
  "gas_reserve_atomic" BIGINT NOT NULL,
  "unavailable_atomic" BIGINT NOT NULL,
  "sellable_atomic" BIGINT NOT NULL,
  "verification_status" "TreasuryVerificationStatus" NOT NULL,
  "provider_reference" VARCHAR(255),
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "treasury_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_snapshots_nonnegative_check" CHECK (
    "controlled_atomic" >= 0 AND "provider_available_atomic" >= 0 AND
    "pending_atomic" >= 0 AND "frozen_atomic" >= 0 AND "locked_atomic" >= 0 AND
    ("chain_confirmed_atomic" IS NULL OR "chain_confirmed_atomic" >= 0) AND
    "reserved_atomic" >= 0 AND "safety_buffer_atomic" >= 0 AND
    "gas_reserve_atomic" >= 0 AND "unavailable_atomic" >= 0 AND "sellable_atomic" >= 0
  ),
  CONSTRAINT "treasury_snapshots_available_check" CHECK ("provider_available_atomic" <= "controlled_atomic"),
  CONSTRAINT "treasury_snapshots_unavailable_check" CHECK ("unavailable_atomic" = "controlled_atomic" - "provider_available_atomic"),
  CONSTRAINT "treasury_snapshots_expiry_check" CHECK ("expires_at" > "observed_at"),
  CONSTRAINT "treasury_snapshots_verification_check" CHECK (
    ("verification_status" = 'MATCHED' AND "chain_confirmed_atomic" = "controlled_atomic") OR
    ("verification_status" = 'MISMATCH' AND "chain_confirmed_atomic" IS NOT NULL AND "chain_confirmed_atomic" <> "controlled_atomic") OR
    ("verification_status" IN ('UNVERIFIED', 'STALE') AND "chain_confirmed_atomic" IS NULL)
  ),
  CONSTRAINT "treasury_snapshots_sellable_check" CHECK (
    "sellable_atomic" = CASE
      WHEN "verification_status" IN ('MISMATCH', 'STALE') THEN 0
      ELSE greatest("provider_available_atomic" - "reserved_atomic" - "safety_buffer_atomic" - "gas_reserve_atomic", 0)
    END
  )
);
CREATE INDEX "treasury_snapshots_asset_network_observed_idx" ON "treasury_snapshots" ("asset_network_id", "observed_at");

CREATE TABLE "treasury_inventory_state" (
  "asset_network_id" UUID NOT NULL REFERENCES "asset_networks"("id") ON DELETE RESTRICT,
  "latest_snapshot_id" UUID NOT NULL REFERENCES "treasury_snapshots"("id") ON DELETE RESTRICT,
  "sellable_atomic" BIGINT NOT NULL,
  "reserved_atomic" BIGINT NOT NULL,
  "verification_status" "TreasuryVerificationStatus" NOT NULL,
  "evidence_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "treasury_inventory_state_pkey" PRIMARY KEY ("asset_network_id"),
  CONSTRAINT "treasury_inventory_state_latest_snapshot_key" UNIQUE ("latest_snapshot_id"),
  CONSTRAINT "treasury_inventory_state_amounts_check" CHECK ("sellable_atomic" >= 0 AND "reserved_atomic" >= 0)
);

CREATE TABLE "treasury_sync_jobs" (
  "id" UUID NOT NULL,
  "treasury_wallet_id" UUID NOT NULL REFERENCES "treasury_wallets"("id") ON DELETE RESTRICT,
  "status" "TreasurySyncJobStatus" NOT NULL DEFAULT 'PENDING',
  "next_sync_at" TIMESTAMPTZ(6) NOT NULL,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(100),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "treasury_sync_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_sync_jobs_treasury_wallet_id_key" UNIQUE ("treasury_wallet_id"),
  CONSTRAINT "treasury_sync_jobs_attempt_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "treasury_sync_jobs_lease_check" CHECK (
    ("status" = 'PENDING' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL) OR
    ("status" = 'LEASED' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
  )
);
CREATE INDEX "treasury_sync_jobs_status_next_sync_idx" ON "treasury_sync_jobs" ("status", "next_sync_at");

CREATE TABLE "treasury_funding_intents" (
  "id" UUID NOT NULL,
  "treasury_wallet_id" UUID NOT NULL REFERENCES "treasury_wallets"("id") ON DELETE RESTRICT,
  "asset_network_id" UUID NOT NULL REFERENCES "asset_networks"("id") ON DELETE RESTRICT,
  "expected_atomic" BIGINT NOT NULL,
  "status" "FundingIntentStatus" NOT NULL DEFAULT 'CREATED',
  "transaction_hash" VARCHAR(255),
  "actor_id" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "observed_at" TIMESTAMPTZ(6),
  "confirmed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "treasury_funding_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "treasury_funding_intents_amount_check" CHECK ("expected_atomic" > 0),
  CONSTRAINT "treasury_funding_intents_state_check" CHECK (
    ("status" = 'CREATED' AND "observed_at" IS NULL AND "confirmed_at" IS NULL) OR
    ("status" = 'OBSERVED' AND "observed_at" IS NOT NULL AND "confirmed_at" IS NULL) OR
    ("status" = 'CONFIRMED' AND "observed_at" IS NOT NULL AND "confirmed_at" IS NOT NULL) OR
    ("status" = 'CANCELLED' AND "confirmed_at" IS NULL)
  )
);
CREATE INDEX "treasury_funding_intents_asset_network_status_idx" ON "treasury_funding_intents" ("asset_network_id", "status");

CREATE FUNCTION "validate_treasury_snapshot"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE configured_wallet "treasury_wallets"%ROWTYPE;
BEGIN
  SELECT * INTO configured_wallet FROM "treasury_wallets" WHERE "id" = NEW."treasury_wallet_id";
  IF NOT FOUND OR configured_wallet."status" <> 'ENABLED'
    OR configured_wallet."asset_network_id" <> NEW."asset_network_id"
    OR configured_wallet."safety_buffer_atomic" <> NEW."safety_buffer_atomic"
    OR configured_wallet."gas_reserve_atomic" <> NEW."gas_reserve_atomic"
    OR NEW."expires_at" <> NEW."observed_at" + make_interval(secs => configured_wallet."stale_after_seconds")
    OR (configured_wallet."verification_required" AND NEW."verification_status" = 'UNVERIFIED') THEN
    RAISE EXCEPTION 'treasury snapshot does not match enabled wallet policy' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "treasury_snapshots_evidence_check" BEFORE INSERT ON "treasury_snapshots" FOR EACH ROW EXECUTE FUNCTION "validate_treasury_snapshot"();

CREATE FUNCTION "prevent_treasury_snapshot_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'treasury snapshots are immutable' USING ERRCODE = '23514'; END; $$;
CREATE TRIGGER "treasury_snapshots_immutable" BEFORE UPDATE OR DELETE ON "treasury_snapshots" FOR EACH ROW EXECUTE FUNCTION "prevent_treasury_snapshot_mutation"();

CREATE FUNCTION "validate_treasury_inventory_state"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE source_snapshot "treasury_snapshots"%ROWTYPE;
BEGIN
  SELECT * INTO source_snapshot FROM "treasury_snapshots" WHERE "id" = NEW."latest_snapshot_id";
  IF NOT FOUND OR source_snapshot."asset_network_id" <> NEW."asset_network_id"
    OR source_snapshot."sellable_atomic" <> NEW."sellable_atomic"
    OR source_snapshot."reserved_atomic" <> NEW."reserved_atomic"
    OR source_snapshot."verification_status" <> NEW."verification_status"
    OR source_snapshot."expires_at" <> NEW."evidence_expires_at" THEN
    RAISE EXCEPTION 'inventory state does not match snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "treasury_inventory_state_evidence_check" BEFORE INSERT OR UPDATE ON "treasury_inventory_state" FOR EACH ROW EXECUTE FUNCTION "validate_treasury_inventory_state"();

CREATE FUNCTION "protect_treasury_funding_intent"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE wallet_network_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'funding intents cannot be deleted' USING ERRCODE = '23514';
  END IF;
  SELECT "asset_network_id" INTO wallet_network_id FROM "treasury_wallets" WHERE "id" = NEW."treasury_wallet_id";
  IF NOT FOUND OR wallet_network_id <> NEW."asset_network_id" THEN
    RAISE EXCEPTION 'funding intent wallet and asset-network do not match' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."id" IS DISTINCT FROM OLD."id" OR
    NEW."treasury_wallet_id" IS DISTINCT FROM OLD."treasury_wallet_id" OR
    NEW."asset_network_id" IS DISTINCT FROM OLD."asset_network_id" OR
    NEW."expected_atomic" IS DISTINCT FROM OLD."expected_atomic" OR
    NEW."actor_id" IS DISTINCT FROM OLD."actor_id" OR
    NEW."reason" IS DISTINCT FROM OLD."reason" OR
    NEW."created_at" IS DISTINCT FROM OLD."created_at" OR
    NOT ((OLD."status" = 'CREATED' AND NEW."status" IN ('OBSERVED', 'CANCELLED')) OR
         (OLD."status" = 'OBSERVED' AND NEW."status" IN ('CONFIRMED', 'CANCELLED')))
  ) THEN
    RAISE EXCEPTION 'invalid funding intent mutation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "treasury_funding_intents_protected" BEFORE INSERT OR UPDATE OR DELETE ON "treasury_funding_intents" FOR EACH ROW EXECUTE FUNCTION "protect_treasury_funding_intent"();
