-- CreateEnum
CREATE TYPE "NetworkTransferType" AS ENUM ('NATIVE', 'TOKEN');

-- CreateEnum
CREATE TYPE "FeeObservationSource" AS ENUM ('PROVIDER', 'RPC');

-- CreateEnum
CREATE TYPE "NetworkFeePolicyStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "NetworkFeeSnapshotStatus" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NetworkFeeRefreshJobStatus" AS ENUM ('PENDING', 'LEASED');

-- CreateTable
CREATE TABLE "network_fee_policy_versions" (
    "id" UUID NOT NULL,
    "asset_network_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "transfer_type" "NetworkTransferType" NOT NULL,
    "native_fee_asset_id" UUID NOT NULL,
    "charge_asset_id" UUID NOT NULL,
    "required_observations" INTEGER NOT NULL,
    "max_deviation_bps" INTEGER NOT NULL,
    "percentage_buffer_bps" INTEGER NOT NULL,
    "fixed_buffer_atomic" BIGINT NOT NULL,
    "fixed_service_fee_atomic" BIGINT NOT NULL,
    "percentage_service_fee_bps" INTEGER NOT NULL,
    "observation_ttl_seconds" INTEGER NOT NULL,
    "snapshot_ttl_seconds" INTEGER NOT NULL,
    "quote_ttl_seconds" INTEGER NOT NULL,
    "execution_tolerance_bps" INTEGER NOT NULL,
    "refresh_interval_seconds" INTEGER NOT NULL,
    "status" "NetworkFeePolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "configuration_version_id" INTEGER NOT NULL,
    "actor_id" VARCHAR(100) NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_fee_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_conversion_evidence" (
    "id" UUID NOT NULL,
    "from_asset_id" UUID NOT NULL,
    "to_asset_id" UUID NOT NULL,
    "numerator" BIGINT NOT NULL,
    "denominator" BIGINT NOT NULL,
    "source_reference" VARCHAR(200) NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_conversion_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_fee_observations" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "source" "FeeObservationSource" NOT NULL,
    "estimated_native_fee_atomic" BIGINT NOT NULL,
    "safe_reference" VARCHAR(200),
    "deduplication_key" VARCHAR(200) NOT NULL,
    "observed_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_fee_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_fee_snapshots" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "status" "NetworkFeeSnapshotStatus" NOT NULL,
    "rejection_reason" VARCHAR(100),
    "estimated_native_fee_atomic" BIGINT,
    "percentage_buffer_atomic" BIGINT,
    "fixed_buffer_atomic" BIGINT NOT NULL,
    "buffered_native_fee_atomic" BIGINT,
    "charged_network_fee_atomic" BIGINT,
    "deviation_bps" INTEGER,
    "conversion_numerator" BIGINT,
    "conversion_denominator" BIGINT,
    "conversion_evidence_id" UUID,
    "rounding_mode" "FeeRoundingMode" NOT NULL DEFAULT 'CEILING',
    "calculated_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_fee_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_fee_snapshot_inputs" (
    "snapshot_id" UUID NOT NULL,
    "observation_id" UUID NOT NULL,

    CONSTRAINT "network_fee_snapshot_inputs_pkey" PRIMARY KEY ("snapshot_id","observation_id")
);

-- CreateTable
CREATE TABLE "network_fee_refresh_jobs" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "status" "NetworkFeeRefreshJobStatus" NOT NULL DEFAULT 'PENDING',
    "next_refresh_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "network_fee_refresh_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_fee_quotes" (
    "id" UUID NOT NULL,
    "asset_network_id" UUID NOT NULL,
    "transfer_type" "NetworkTransferType" NOT NULL,
    "fee_snapshot_id" UUID NOT NULL,
    "customer_reference" VARCHAR(100) NOT NULL,
    "destination_address" VARCHAR(255) NOT NULL,
    "principal_atomic" BIGINT NOT NULL,
    "estimated_native_fee_atomic" BIGINT NOT NULL,
    "buffered_native_fee_atomic" BIGINT NOT NULL,
    "network_fee_atomic" BIGINT NOT NULL,
    "fixed_service_fee_atomic" BIGINT NOT NULL,
    "percentage_service_fee_atomic" BIGINT NOT NULL,
    "service_fee_atomic" BIGINT NOT NULL,
    "total_debit_atomic" BIGINT NOT NULL,
    "recipient_amount_atomic" BIGINT NOT NULL,
    "asset_decimals" INTEGER NOT NULL,
    "native_fee_asset_decimals" INTEGER NOT NULL,
    "rounding_mode" "FeeRoundingMode" NOT NULL DEFAULT 'CEILING',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_fee_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "network_fee_policy_versions_asset_network_id_transfer_type__idx" ON "network_fee_policy_versions"("asset_network_id", "transfer_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "network_fee_policy_versions_asset_network_id_transfer_type__key" ON "network_fee_policy_versions"("asset_network_id", "transfer_type", "version");

-- CreateIndex
CREATE INDEX "fee_conversion_evidence_from_asset_id_to_asset_id_observed__idx" ON "fee_conversion_evidence"("from_asset_id", "to_asset_id", "observed_at");

-- CreateIndex
CREATE INDEX "network_fee_observations_policy_id_source_observed_at_idx" ON "network_fee_observations"("policy_id", "source", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "network_fee_observations_policy_id_source_deduplication_key_key" ON "network_fee_observations"("policy_id", "source", "deduplication_key");

-- CreateIndex
CREATE INDEX "network_fee_snapshots_policy_id_status_calculated_at_idx" ON "network_fee_snapshots"("policy_id", "status", "calculated_at");

-- CreateIndex
CREATE UNIQUE INDEX "network_fee_refresh_jobs_policy_id_key" ON "network_fee_refresh_jobs"("policy_id");

-- CreateIndex
CREATE INDEX "network_fee_refresh_jobs_status_next_refresh_at_idx" ON "network_fee_refresh_jobs"("status", "next_refresh_at");

-- CreateIndex
CREATE INDEX "withdrawal_fee_quotes_asset_network_id_created_at_idx" ON "withdrawal_fee_quotes"("asset_network_id", "created_at");

-- CreateIndex
CREATE INDEX "withdrawal_fee_quotes_expires_at_idx" ON "withdrawal_fee_quotes"("expires_at");

-- AddForeignKey
ALTER TABLE "network_fee_policy_versions" ADD CONSTRAINT "network_fee_policy_versions_asset_network_id_fkey" FOREIGN KEY ("asset_network_id") REFERENCES "asset_networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_fee_policy_versions" ADD CONSTRAINT "network_fee_policy_versions_native_fee_asset_id_fkey" FOREIGN KEY ("native_fee_asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_fee_policy_versions" ADD CONSTRAINT "network_fee_policy_versions_charge_asset_id_fkey" FOREIGN KEY ("charge_asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_fee_policy_versions" ADD CONSTRAINT "network_fee_policy_versions_configuration_version_id_fkey" FOREIGN KEY ("configuration_version_id") REFERENCES "configuration_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_conversion_evidence" ADD CONSTRAINT "fee_conversion_evidence_from_asset_id_fkey" FOREIGN KEY ("from_asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_conversion_evidence" ADD CONSTRAINT "fee_conversion_evidence_to_asset_id_fkey" FOREIGN KEY ("to_asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_fee_observations" ADD CONSTRAINT "network_fee_observations_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "network_fee_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_fee_snapshots" ADD CONSTRAINT "network_fee_snapshots_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "network_fee_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_fee_snapshots" ADD CONSTRAINT "network_fee_snapshots_conversion_evidence_id_fkey" FOREIGN KEY ("conversion_evidence_id") REFERENCES "fee_conversion_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_fee_snapshot_inputs" ADD CONSTRAINT "network_fee_snapshot_inputs_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "network_fee_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_fee_snapshot_inputs" ADD CONSTRAINT "network_fee_snapshot_inputs_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "network_fee_observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_fee_refresh_jobs" ADD CONSTRAINT "network_fee_refresh_jobs_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "network_fee_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_fee_quotes" ADD CONSTRAINT "withdrawal_fee_quotes_asset_network_id_fkey" FOREIGN KEY ("asset_network_id") REFERENCES "asset_networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_fee_quotes" ADD CONSTRAINT "withdrawal_fee_quotes_fee_snapshot_id_fkey" FOREIGN KEY ("fee_snapshot_id") REFERENCES "network_fee_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial and lifecycle constraints reviewed after Prisma generation.
ALTER TABLE "network_fee_policy_versions" ADD CONSTRAINT "network_fee_policy_bounds_check" CHECK (
  "version" > 0 AND "required_observations" BETWEEN 1 AND 2
  AND "max_deviation_bps" BETWEEN 0 AND 10000
  AND "percentage_buffer_bps" BETWEEN 0 AND 10000
  AND "percentage_service_fee_bps" BETWEEN 0 AND 10000
  AND "execution_tolerance_bps" BETWEEN 0 AND 10000
  AND "fixed_buffer_atomic" >= 0 AND "fixed_service_fee_atomic" >= 0
  AND "observation_ttl_seconds" > 0 AND "snapshot_ttl_seconds" > 0
  AND "quote_ttl_seconds" > 0 AND "refresh_interval_seconds" > 0
);
CREATE UNIQUE INDEX "network_fee_one_active_policy_idx"
  ON "network_fee_policy_versions" ("asset_network_id", "transfer_type")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "fee_conversion_evidence" ADD CONSTRAINT "fee_conversion_evidence_values_check" CHECK (
  "from_asset_id" <> "to_asset_id" AND "numerator" > 0 AND "denominator" > 0
  AND "expires_at" > "observed_at"
);
ALTER TABLE "network_fee_observations" ADD CONSTRAINT "network_fee_observation_values_check" CHECK (
  "estimated_native_fee_atomic" > 0 AND "expires_at" > "observed_at"
);
ALTER TABLE "network_fee_snapshots" ADD CONSTRAINT "network_fee_snapshot_shape_check" CHECK (
  ("status" = 'ACCEPTED' AND "rejection_reason" IS NULL
    AND "estimated_native_fee_atomic" > 0 AND "percentage_buffer_atomic" >= 0
    AND "buffered_native_fee_atomic" > 0 AND "charged_network_fee_atomic" > 0
    AND "deviation_bps" BETWEEN 0 AND 10000
    AND "conversion_numerator" > 0 AND "conversion_denominator" > 0
    AND "expires_at" > "calculated_at")
  OR
  ("status" = 'REJECTED' AND "rejection_reason" IS NOT NULL
    AND "estimated_native_fee_atomic" IS NULL AND "percentage_buffer_atomic" IS NULL
    AND "buffered_native_fee_atomic" IS NULL AND "charged_network_fee_atomic" IS NULL
    AND "deviation_bps" IS NULL AND "conversion_numerator" IS NULL
    AND "conversion_denominator" IS NULL AND "expires_at" IS NULL)
);
ALTER TABLE "network_fee_refresh_jobs" ADD CONSTRAINT "network_fee_refresh_job_lease_check" CHECK (
  ("status" = 'PENDING' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
  OR ("status" = 'LEASED' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
);
ALTER TABLE "withdrawal_fee_quotes" ADD CONSTRAINT "withdrawal_fee_quote_amounts_check" CHECK (
  "principal_atomic" > 0 AND "estimated_native_fee_atomic" > 0
  AND "buffered_native_fee_atomic" > 0 AND "network_fee_atomic" > 0
  AND "fixed_service_fee_atomic" >= 0 AND "percentage_service_fee_atomic" >= 0
  AND "service_fee_atomic" = "fixed_service_fee_atomic" + "percentage_service_fee_atomic"
  AND "recipient_amount_atomic" = "principal_atomic"
  AND "total_debit_atomic" = "principal_atomic" + "network_fee_atomic" + "service_fee_atomic"
  AND "asset_decimals" BETWEEN 0 AND 255 AND "native_fee_asset_decimals" BETWEEN 0 AND 255
  AND "expires_at" > "created_at"
);

CREATE FUNCTION "protect_network_fee_history"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'network fee evidence is immutable' USING ERRCODE = '23514';
END; $$;
CREATE TRIGGER "fee_conversion_evidence_immutable" BEFORE UPDATE OR DELETE ON "fee_conversion_evidence"
  FOR EACH ROW EXECUTE FUNCTION "protect_network_fee_history"();
CREATE TRIGGER "network_fee_observations_immutable" BEFORE UPDATE OR DELETE ON "network_fee_observations"
  FOR EACH ROW EXECUTE FUNCTION "protect_network_fee_history"();
CREATE TRIGGER "network_fee_snapshots_immutable" BEFORE UPDATE OR DELETE ON "network_fee_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "protect_network_fee_history"();
CREATE TRIGGER "network_fee_snapshot_inputs_immutable" BEFORE UPDATE OR DELETE ON "network_fee_snapshot_inputs"
  FOR EACH ROW EXECUTE FUNCTION "protect_network_fee_history"();
CREATE TRIGGER "withdrawal_fee_quotes_immutable" BEFORE UPDATE OR DELETE ON "withdrawal_fee_quotes"
  FOR EACH ROW EXECUTE FUNCTION "protect_network_fee_history"();

CREATE FUNCTION "validate_network_fee_policy"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configured_asset UUID;
BEGIN
  SELECT "asset_id" INTO configured_asset FROM "asset_networks" WHERE "id" = NEW."asset_network_id";
  IF configured_asset IS NULL OR configured_asset <> NEW."charge_asset_id" THEN
    RAISE EXCEPTION 'charge asset must equal withdrawn asset for MVP' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "network_fee_policy_validated" BEFORE INSERT OR UPDATE ON "network_fee_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "validate_network_fee_policy"();

CREATE FUNCTION "validate_network_fee_quote"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_snapshot "network_fee_snapshots"%ROWTYPE;
DECLARE source_policy "network_fee_policy_versions"%ROWTYPE;
BEGIN
  SELECT * INTO source_snapshot FROM "network_fee_snapshots" WHERE "id" = NEW."fee_snapshot_id";
  SELECT * INTO source_policy FROM "network_fee_policy_versions" WHERE "id" = source_snapshot."policy_id";
  IF source_snapshot."status" <> 'ACCEPTED' OR source_snapshot."expires_at" <= NEW."created_at"
    OR source_policy."asset_network_id" <> NEW."asset_network_id"
    OR source_policy."transfer_type" <> NEW."transfer_type"
    OR source_snapshot."estimated_native_fee_atomic" <> NEW."estimated_native_fee_atomic"
    OR source_snapshot."buffered_native_fee_atomic" <> NEW."buffered_native_fee_atomic"
    OR source_snapshot."charged_network_fee_atomic" <> NEW."network_fee_atomic" THEN
    RAISE EXCEPTION 'withdrawal fee quote does not match fresh snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "withdrawal_fee_quote_validated" BEFORE INSERT ON "withdrawal_fee_quotes"
  FOR EACH ROW EXECUTE FUNCTION "validate_network_fee_quote"();
