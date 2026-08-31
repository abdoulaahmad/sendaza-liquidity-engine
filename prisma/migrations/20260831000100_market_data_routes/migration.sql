CREATE TYPE "PricingProviderType" AS ENUM ('COINBASE_PUBLIC', 'MANUAL', 'DETERMINISTIC_FAKE');
CREATE TYPE "PricingInstrumentKind" AS ENUM ('ASSET', 'FIAT');
CREATE TYPE "RouteLegOperation" AS ENUM ('MULTIPLY', 'DIVIDE');
CREATE TYPE "ReferenceRateStatus" AS ENUM ('ACCEPTED', 'REJECTED');
CREATE TYPE "RateRoundingMode" AS ENUM ('HALF_EVEN');

CREATE TABLE "pricing_providers" (
  "id" UUID PRIMARY KEY,
  "code" VARCHAR(50) NOT NULL UNIQUE,
  "type" "PricingProviderType" NOT NULL,
  "configuration_reference" VARCHAR(200),
  "status" "RegistryStatus" NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "pricing_instruments" (
  "id" UUID PRIMARY KEY,
  "kind" "PricingInstrumentKind" NOT NULL,
  "asset_id" UUID UNIQUE REFERENCES "assets"("id") ON DELETE RESTRICT,
  "fiat_currency_id" UUID UNIQUE REFERENCES "fiat_currencies"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_instruments_kind_reference_check" CHECK (
    ("kind" = 'ASSET' AND "asset_id" IS NOT NULL AND "fiat_currency_id" IS NULL)
    OR ("kind" = 'FIAT' AND "asset_id" IS NULL AND "fiat_currency_id" IS NOT NULL)
  )
);

CREATE TABLE "provider_price_pairs" (
  "id" UUID PRIMARY KEY,
  "provider_id" UUID NOT NULL REFERENCES "pricing_providers"("id") ON DELETE RESTRICT,
  "base_instrument_id" UUID NOT NULL REFERENCES "pricing_instruments"("id") ON DELETE RESTRICT,
  "quote_instrument_id" UUID NOT NULL REFERENCES "pricing_instruments"("id") ON DELETE RESTRICT,
  "provider_pair_code" VARCHAR(100) NOT NULL,
  "price_scale" INTEGER NOT NULL,
  "max_age_seconds" INTEGER NOT NULL,
  "sequence_enforced" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" "RegistryStatus" NOT NULL DEFAULT 'ENABLED',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_price_pairs_provider_code_key" UNIQUE ("provider_id", "provider_pair_code"),
  CONSTRAINT "provider_price_pairs_instruments_key" UNIQUE ("provider_id", "base_instrument_id", "quote_instrument_id"),
  CONSTRAINT "provider_price_pairs_distinct_instruments_check" CHECK ("base_instrument_id" <> "quote_instrument_id"),
  CONSTRAINT "provider_price_pairs_scale_check" CHECK ("price_scale" BETWEEN 0 AND 30),
  CONSTRAINT "provider_price_pairs_age_check" CHECK ("max_age_seconds" > 0)
);

CREATE TABLE "price_observations" (
  "id" UUID PRIMARY KEY,
  "provider_price_pair_id" UUID NOT NULL REFERENCES "provider_price_pairs"("id") ON DELETE RESTRICT,
  "normalized_rate" DECIMAL(60,30) NOT NULL,
  "raw_rate" VARCHAR(160) NOT NULL,
  "provider_observed_at" TIMESTAMPTZ NOT NULL,
  "provider_sequence" VARCHAR(100),
  "deduplication_key" VARCHAR(200) NOT NULL,
  "safe_provider_reference" VARCHAR(200),
  "received_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "price_observations_pair_deduplication_key" UNIQUE ("provider_price_pair_id", "deduplication_key"),
  CONSTRAINT "price_observations_rate_check" CHECK ("normalized_rate" > 0),
  CONSTRAINT "price_observations_raw_rate_check" CHECK ("raw_rate" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  CONSTRAINT "price_observations_time_check" CHECK ("provider_observed_at" <= "received_at" + INTERVAL '5 minutes')
);
CREATE INDEX "price_observations_pair_observed_at_idx"
  ON "price_observations" ("provider_price_pair_id", "provider_observed_at");
CREATE UNIQUE INDEX "price_observations_pair_sequence_key"
  ON "price_observations" ("provider_price_pair_id", "provider_sequence")
  WHERE "provider_sequence" IS NOT NULL;

CREATE TABLE "conversion_routes" (
  "id" UUID PRIMARY KEY,
  "market_id" UUID NOT NULL REFERENCES "markets"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL,
  "output_scale" INTEGER NOT NULL,
  "max_age_seconds" INTEGER NOT NULL,
  "max_deviation_bps" INTEGER NOT NULL,
  "stablecoin_guard_pair_id" UUID REFERENCES "provider_price_pairs"("id") ON DELETE RESTRICT,
  "stablecoin_expected_rate" DECIMAL(60,30),
  "stablecoin_tolerance_bps" INTEGER,
  "status" "RegistryStatus" NOT NULL DEFAULT 'DISABLED',
  "configuration_version_id" INTEGER NOT NULL REFERENCES "configuration_versions"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversion_routes_market_version_key" UNIQUE ("market_id", "version"),
  CONSTRAINT "conversion_routes_version_check" CHECK ("version" > 0),
  CONSTRAINT "conversion_routes_scale_check" CHECK ("output_scale" BETWEEN 0 AND 30),
  CONSTRAINT "conversion_routes_age_check" CHECK ("max_age_seconds" > 0),
  CONSTRAINT "conversion_routes_deviation_check" CHECK ("max_deviation_bps" BETWEEN 0 AND 10000),
  CONSTRAINT "conversion_routes_stablecoin_guard_check" CHECK (
    ("stablecoin_guard_pair_id" IS NULL AND "stablecoin_expected_rate" IS NULL AND "stablecoin_tolerance_bps" IS NULL)
    OR ("stablecoin_guard_pair_id" IS NOT NULL AND "stablecoin_expected_rate" > 0
      AND "stablecoin_tolerance_bps" BETWEEN 0 AND 10000)
  )
);
CREATE UNIQUE INDEX "conversion_routes_one_enabled_per_market_key"
  ON "conversion_routes" ("market_id") WHERE "status" = 'ENABLED';

CREATE TABLE "conversion_route_legs" (
  "id" UUID PRIMARY KEY,
  "route_id" UUID NOT NULL REFERENCES "conversion_routes"("id") ON DELETE RESTRICT,
  "sequence" INTEGER NOT NULL,
  "provider_price_pair_id" UUID NOT NULL REFERENCES "provider_price_pairs"("id") ON DELETE RESTRICT,
  "operation" "RouteLegOperation" NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversion_route_legs_route_sequence_key" UNIQUE ("route_id", "sequence"),
  CONSTRAINT "conversion_route_legs_sequence_check" CHECK ("sequence" > 0)
);

CREATE TABLE "reference_rate_snapshots" (
  "id" UUID PRIMARY KEY,
  "route_id" UUID NOT NULL REFERENCES "conversion_routes"("id") ON DELETE RESTRICT,
  "rate" DECIMAL(60,30),
  "output_scale" INTEGER NOT NULL,
  "rounding_mode" "RateRoundingMode" NOT NULL,
  "status" "ReferenceRateStatus" NOT NULL,
  "rejection_reason" VARCHAR(100),
  "calculated_at" TIMESTAMPTZ NOT NULL,
  "valid_until" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reference_rate_snapshots_scale_check" CHECK ("output_scale" BETWEEN 0 AND 30),
  CONSTRAINT "reference_rate_snapshots_state_check" CHECK (
    ("status" = 'ACCEPTED' AND "rate" > 0 AND "rejection_reason" IS NULL
      AND "valid_until" IS NOT NULL AND "valid_until" > "calculated_at")
    OR ("status" = 'REJECTED' AND "rate" IS NULL AND "rejection_reason" IS NOT NULL
      AND "valid_until" IS NULL)
  )
);
CREATE INDEX "reference_rate_snapshots_route_status_calculated_at_idx"
  ON "reference_rate_snapshots" ("route_id", "status", "calculated_at");

CREATE TABLE "reference_rate_snapshot_inputs" (
  "snapshot_id" UUID NOT NULL REFERENCES "reference_rate_snapshots"("id") ON DELETE RESTRICT,
  "route_leg_id" UUID NOT NULL REFERENCES "conversion_route_legs"("id") ON DELETE RESTRICT,
  "observation_id" UUID NOT NULL REFERENCES "price_observations"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("snapshot_id", "route_leg_id")
);

CREATE TABLE "manual_price_versions" (
  "id" UUID PRIMARY KEY,
  "provider_price_pair_id" UUID NOT NULL REFERENCES "provider_price_pairs"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL,
  "raw_rate" VARCHAR(160) NOT NULL,
  "normalized_rate" DECIMAL(60,30) NOT NULL,
  "effective_from" TIMESTAMPTZ NOT NULL,
  "effective_until" TIMESTAMPTZ,
  "actor_id" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "configuration_version_id" INTEGER NOT NULL REFERENCES "configuration_versions"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manual_price_versions_pair_version_key" UNIQUE ("provider_price_pair_id", "version"),
  CONSTRAINT "manual_price_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "manual_price_versions_rate_check" CHECK ("normalized_rate" > 0),
  CONSTRAINT "manual_price_versions_raw_rate_check" CHECK ("raw_rate" ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'),
  CONSTRAINT "manual_price_versions_effective_check" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
  CONSTRAINT "manual_price_versions_reason_check" CHECK (length(trim("reason")) > 0)
);
CREATE INDEX "manual_price_versions_pair_effective_from_idx"
  ON "manual_price_versions" ("provider_price_pair_id", "effective_from");

CREATE FUNCTION "prevent_pricing_evidence_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; create linked replacement evidence instead', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION "validate_enabled_conversion_route"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  leg_count INTEGER;
  maximum_sequence INTEGER;
BEGIN
  IF NEW."status" = 'ENABLED' THEN
    SELECT count(*), max("sequence") INTO leg_count, maximum_sequence
      FROM "conversion_route_legs" WHERE "route_id" = NEW."id";
    IF leg_count = 0 OR maximum_sequence <> leg_count THEN
      RAISE EXCEPTION 'enabled conversion route must have contiguous legs starting at 1'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "conversion_routes_enabled_legs_check"
  AFTER INSERT OR UPDATE OF "status" ON "conversion_routes"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_enabled_conversion_route"();

CREATE FUNCTION "validate_accepted_snapshot_inputs"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  route_leg_count INTEGER;
  valid_input_count INTEGER;
BEGIN
  IF NEW."status" = 'ACCEPTED' THEN
    SELECT count(*) INTO route_leg_count
      FROM "conversion_route_legs" WHERE "route_id" = NEW."route_id";
    SELECT count(*) INTO valid_input_count
      FROM "reference_rate_snapshot_inputs" input
      JOIN "conversion_route_legs" leg ON leg."id" = input."route_leg_id"
      JOIN "price_observations" observation ON observation."id" = input."observation_id"
      WHERE input."snapshot_id" = NEW."id"
        AND leg."route_id" = NEW."route_id"
        AND observation."provider_price_pair_id" = leg."provider_price_pair_id";
    IF route_leg_count = 0 OR valid_input_count <> route_leg_count THEN
      RAISE EXCEPTION 'accepted snapshot must contain one matching observation for every route leg'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "reference_rate_snapshots_complete_inputs_check"
  AFTER INSERT ON "reference_rate_snapshots"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_accepted_snapshot_inputs"();

CREATE TRIGGER "price_observations_immutable"
  BEFORE UPDATE OR DELETE ON "price_observations"
  FOR EACH ROW EXECUTE FUNCTION "prevent_pricing_evidence_mutation"();
CREATE TRIGGER "conversion_route_legs_immutable"
  BEFORE UPDATE OR DELETE ON "conversion_route_legs"
  FOR EACH ROW EXECUTE FUNCTION "prevent_pricing_evidence_mutation"();
CREATE TRIGGER "reference_rate_snapshots_immutable"
  BEFORE UPDATE OR DELETE ON "reference_rate_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "prevent_pricing_evidence_mutation"();
CREATE TRIGGER "reference_rate_snapshot_inputs_immutable"
  BEFORE UPDATE OR DELETE ON "reference_rate_snapshot_inputs"
  FOR EACH ROW EXECUTE FUNCTION "prevent_pricing_evidence_mutation"();
CREATE TRIGGER "manual_price_versions_immutable"
  BEFORE UPDATE OR DELETE ON "manual_price_versions"
  FOR EACH ROW EXECUTE FUNCTION "prevent_pricing_evidence_mutation"();
