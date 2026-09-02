DO $$ BEGIN CREATE TYPE "PurchaseStatus" AS ENUM ('RESERVED', 'COMPLETED', 'ROLLED_BACK', 'RECONCILIATION_REQUIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'ALLOCATED', 'RELEASED', 'HELD_RECONCILIATION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PurchaseSettlementOutcome" AS ENUM ('COMMITTED', 'ROLLED_BACK'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PurchaseTimeoutJobStatus" AS ENUM ('PENDING', 'LEASED', 'COMPLETED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "treasury_snapshots" ADD COLUMN IF NOT EXISTS "allocated_atomic" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "treasury_inventory_state" ADD COLUMN IF NOT EXISTS "allocated_atomic" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "treasury_snapshots" DROP CONSTRAINT IF EXISTS "treasury_snapshots_nonnegative_check";
ALTER TABLE "treasury_snapshots" DROP CONSTRAINT IF EXISTS "treasury_snapshots_sellable_check";
ALTER TABLE "treasury_snapshots" ADD CONSTRAINT "treasury_snapshots_nonnegative_check" CHECK (
  "controlled_atomic" >= 0 AND "provider_available_atomic" >= 0 AND "pending_atomic" >= 0
  AND "frozen_atomic" >= 0 AND "locked_atomic" >= 0
  AND ("chain_confirmed_atomic" IS NULL OR "chain_confirmed_atomic" >= 0)
  AND "reserved_atomic" >= 0 AND "allocated_atomic" >= 0 AND "safety_buffer_atomic" >= 0
  AND "gas_reserve_atomic" >= 0 AND "unavailable_atomic" >= 0 AND "sellable_atomic" >= 0
);
ALTER TABLE "treasury_snapshots" ADD CONSTRAINT "treasury_snapshots_sellable_check" CHECK (
  "sellable_atomic" = CASE WHEN "verification_status" IN ('MISMATCH', 'STALE') THEN 0
  ELSE greatest("provider_available_atomic" - "reserved_atomic" - "allocated_atomic"
    - "safety_buffer_atomic" - "gas_reserve_atomic", 0) END
);
ALTER TABLE "treasury_inventory_state" DROP CONSTRAINT IF EXISTS "treasury_inventory_state_amounts_check";
ALTER TABLE "treasury_inventory_state" ADD CONSTRAINT "treasury_inventory_state_amounts_check"
  CHECK ("sellable_atomic" >= 0 AND "reserved_atomic" >= 0 AND "allocated_atomic" >= 0);

CREATE OR REPLACE FUNCTION "validate_treasury_inventory_state"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE source_snapshot "treasury_snapshots"%ROWTYPE;
BEGIN
  SELECT * INTO source_snapshot FROM "treasury_snapshots" WHERE "id" = NEW."latest_snapshot_id";
  IF NOT FOUND OR source_snapshot."asset_network_id" <> NEW."asset_network_id"
    OR source_snapshot."verification_status" <> NEW."verification_status"
    OR source_snapshot."expires_at" <> NEW."evidence_expires_at"
    OR NEW."sellable_atomic" <> (CASE
      WHEN source_snapshot."verification_status" IN ('MISMATCH', 'STALE') THEN 0
      ELSE greatest(source_snapshot."provider_available_atomic" - NEW."reserved_atomic"
        - NEW."allocated_atomic" - source_snapshot."safety_buffer_atomic"
        - source_snapshot."gas_reserve_atomic", 0) END) THEN
    RAISE EXCEPTION 'inventory state does not match snapshot and allocations' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE "purchases" (
  "id" UUID NOT NULL,
  "quote_id" UUID NOT NULL REFERENCES "quotes"("id") ON DELETE RESTRICT,
  "asset_network_id" UUID NOT NULL REFERENCES "asset_networks"("id") ON DELETE RESTRICT,
  "customer_reference" VARCHAR(100) NOT NULL,
  "client_lock_reference" VARCHAR(100) NOT NULL,
  "client_reference" VARCHAR(100) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "debit_atomic" BIGINT NOT NULL,
  "credit_atomic" BIGINT NOT NULL,
  "status" "PurchaseStatus" NOT NULL DEFAULT 'RESERVED',
  "reservation_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),
  "rolled_back_at" TIMESTAMPTZ(6),
  "reconciliation_required_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "purchases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchases_quote_id_key" UNIQUE ("quote_id"),
  CONSTRAINT "purchases_client_lock_reference_key" UNIQUE ("client_lock_reference"),
  CONSTRAINT "purchases_client_reference_key" UNIQUE ("client_reference"),
  CONSTRAINT "purchases_amount_check" CHECK ("debit_atomic" > 0 AND "credit_atomic" > 0),
  CONSTRAINT "purchases_expiry_check" CHECK ("reservation_expires_at" > "created_at"),
  CONSTRAINT "purchases_state_time_check" CHECK (
    ("status" = 'RESERVED' AND "completed_at" IS NULL AND "rolled_back_at" IS NULL AND "reconciliation_required_at" IS NULL) OR
    ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL AND "rolled_back_at" IS NULL) OR
    ("status" = 'ROLLED_BACK' AND "rolled_back_at" IS NOT NULL AND "completed_at" IS NULL) OR
    ("status" = 'RECONCILIATION_REQUIRED' AND "reconciliation_required_at" IS NOT NULL AND "completed_at" IS NULL AND "rolled_back_at" IS NULL)
  )
);
CREATE INDEX "purchases_asset_network_status_idx" ON "purchases" ("asset_network_id", "status");

CREATE TABLE "inventory_reservations" (
  "id" UUID NOT NULL,
  "purchase_id" UUID NOT NULL REFERENCES "purchases"("id") ON DELETE RESTRICT,
  "asset_network_id" UUID NOT NULL REFERENCES "asset_networks"("id") ON DELETE RESTRICT,
  "amount_atomic" BIGINT NOT NULL,
  "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_reservations_purchase_id_key" UNIQUE ("purchase_id"),
  CONSTRAINT "inventory_reservations_amount_check" CHECK ("amount_atomic" > 0),
  CONSTRAINT "inventory_reservations_expiry_check" CHECK ("expires_at" > "created_at")
);
CREATE INDEX "inventory_reservations_asset_network_status_idx" ON "inventory_reservations" ("asset_network_id", "status");

CREATE TABLE "purchase_settlements" (
  "id" UUID NOT NULL,
  "purchase_id" UUID NOT NULL REFERENCES "purchases"("id") ON DELETE RESTRICT,
  "outcome" "PurchaseSettlementOutcome" NOT NULL,
  "client_settlement_reference" VARCHAR(100) NOT NULL,
  "client_settled_at" TIMESTAMPTZ(6) NOT NULL,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_settlements_purchase_id_key" UNIQUE ("purchase_id"),
  CONSTRAINT "purchase_settlements_client_settlement_reference_key" UNIQUE ("client_settlement_reference")
);

CREATE TABLE "purchase_transitions" (
  "id" UUID NOT NULL,
  "purchase_id" UUID NOT NULL REFERENCES "purchases"("id") ON DELETE RESTRICT,
  "from_status" "PurchaseStatus",
  "to_status" "PurchaseStatus" NOT NULL,
  "reason_code" VARCHAR(100) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_transitions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "purchase_transitions_purchase_occurred_idx" ON "purchase_transitions" ("purchase_id", "occurred_at");

CREATE TABLE "purchase_timeout_jobs" (
  "id" UUID NOT NULL,
  "purchase_id" UUID NOT NULL REFERENCES "purchases"("id") ON DELETE RESTRICT,
  "status" "PurchaseTimeoutJobStatus" NOT NULL DEFAULT 'PENDING',
  "due_at" TIMESTAMPTZ(6) NOT NULL,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "purchase_timeout_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_timeout_jobs_purchase_id_key" UNIQUE ("purchase_id"),
  CONSTRAINT "purchase_timeout_jobs_lease_check" CHECK (
    ("status" = 'PENDING' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL) OR
    ("status" = 'LEASED' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL) OR
    ("status" = 'COMPLETED' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
  )
);
CREATE INDEX "purchase_timeout_jobs_status_due_idx" ON "purchase_timeout_jobs" ("status", "due_at");

CREATE FUNCTION "protect_purchase_history"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'purchase history is immutable' USING ERRCODE = '23514'; END; $$;
CREATE TRIGGER "purchase_settlements_immutable" BEFORE UPDATE OR DELETE ON "purchase_settlements" FOR EACH ROW EXECUTE FUNCTION "protect_purchase_history"();
CREATE TRIGGER "purchase_transitions_immutable" BEFORE UPDATE OR DELETE ON "purchase_transitions" FOR EACH ROW EXECUTE FUNCTION "protect_purchase_history"();

CREATE FUNCTION "protect_purchase_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('COMPLETED', 'ROLLED_BACK')
    OR NEW."id" IS DISTINCT FROM OLD."id" OR NEW."quote_id" IS DISTINCT FROM OLD."quote_id"
    OR NEW."asset_network_id" IS DISTINCT FROM OLD."asset_network_id"
    OR NEW."customer_reference" IS DISTINCT FROM OLD."customer_reference"
    OR NEW."client_lock_reference" IS DISTINCT FROM OLD."client_lock_reference"
    OR NEW."client_reference" IS DISTINCT FROM OLD."client_reference"
    OR NEW."correlation_id" IS DISTINCT FROM OLD."correlation_id"
    OR NEW."debit_atomic" IS DISTINCT FROM OLD."debit_atomic"
    OR NEW."credit_atomic" IS DISTINCT FROM OLD."credit_atomic"
    OR NEW."reservation_expires_at" IS DISTINCT FROM OLD."reservation_expires_at"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NOT ((OLD."status" = 'RESERVED' AND NEW."status" IN ('COMPLETED','ROLLED_BACK','RECONCILIATION_REQUIRED'))
      OR (OLD."status" = 'RECONCILIATION_REQUIRED' AND NEW."status" IN ('COMPLETED','ROLLED_BACK'))) THEN
    RAISE EXCEPTION 'invalid purchase mutation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "purchases_protected" BEFORE UPDATE ON "purchases" FOR EACH ROW EXECUTE FUNCTION "protect_purchase_update"();
CREATE TRIGGER "purchases_no_delete" BEFORE DELETE ON "purchases" FOR EACH ROW EXECUTE FUNCTION "protect_purchase_history"();
