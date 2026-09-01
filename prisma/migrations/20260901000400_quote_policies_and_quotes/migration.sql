CREATE TYPE "QuoteSide" AS ENUM ('BUY');
CREATE TYPE "QuotePolicyStatus" AS ENUM ('ACTIVE', 'RETIRED');
CREATE TYPE "FeeRoundingMode" AS ENUM ('CEILING');
CREATE TYPE "DestinationRoundingMode" AS ENUM ('FLOOR');

CREATE TABLE "quote_policy_versions" (
  "id" UUID NOT NULL,
  "market_id" UUID NOT NULL REFERENCES "markets"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL,
  "spread_bps" INTEGER NOT NULL,
  "fixed_fee_atomic" BIGINT NOT NULL,
  "percentage_fee_bps" INTEGER NOT NULL,
  "min_total_debit_atomic" BIGINT NOT NULL,
  "max_total_debit_atomic" BIGINT NOT NULL,
  "quote_ttl_seconds" INTEGER NOT NULL,
  "rate_display_scale" INTEGER NOT NULL,
  "status" "QuotePolicyStatus" NOT NULL,
  "configuration_version_id" INTEGER NOT NULL REFERENCES "configuration_versions"("id") ON DELETE RESTRICT,
  "actor_id" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "effective_from" TIMESTAMPTZ(6) NOT NULL,
  "effective_until" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quote_policy_versions_market_version_key" UNIQUE ("market_id", "version"),
  CONSTRAINT "quote_policy_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "quote_policy_versions_spread_check" CHECK ("spread_bps" BETWEEN 0 AND 10000),
  CONSTRAINT "quote_policy_versions_fixed_fee_check" CHECK ("fixed_fee_atomic" >= 0),
  CONSTRAINT "quote_policy_versions_percentage_fee_check" CHECK ("percentage_fee_bps" BETWEEN 0 AND 10000),
  CONSTRAINT "quote_policy_versions_limits_check" CHECK ("min_total_debit_atomic" > 0 AND "max_total_debit_atomic" >= "min_total_debit_atomic"),
  CONSTRAINT "quote_policy_versions_ttl_check" CHECK ("quote_ttl_seconds" BETWEEN 1 AND 300),
  CONSTRAINT "quote_policy_versions_rate_scale_check" CHECK ("rate_display_scale" BETWEEN 0 AND 30),
  CONSTRAINT "quote_policy_versions_effective_range_check" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
  CONSTRAINT "quote_policy_versions_status_range_check" CHECK (("status" = 'ACTIVE' AND "effective_until" IS NULL) OR ("status" = 'RETIRED' AND "effective_until" IS NOT NULL))
);

CREATE UNIQUE INDEX "quote_policy_versions_one_active_market_key" ON "quote_policy_versions" ("market_id") WHERE "status" = 'ACTIVE';
CREATE INDEX "quote_policy_versions_market_status_effective_idx" ON "quote_policy_versions" ("market_id", "status", "effective_from");

CREATE TABLE "quotes" (
  "id" UUID NOT NULL,
  "side" "QuoteSide" NOT NULL,
  "market_id" UUID NOT NULL REFERENCES "markets"("id") ON DELETE RESTRICT,
  "backing_asset_network_id" UUID NOT NULL REFERENCES "asset_networks"("id") ON DELETE RESTRICT,
  "reference_rate_snapshot_id" UUID NOT NULL REFERENCES "reference_rate_snapshots"("id") ON DELETE RESTRICT,
  "quote_policy_version_id" UUID NOT NULL REFERENCES "quote_policy_versions"("id") ON DELETE RESTRICT,
  "configuration_version_id" INTEGER NOT NULL REFERENCES "configuration_versions"("id") ON DELETE RESTRICT,
  "total_debit_atomic" BIGINT NOT NULL,
  "fixed_fee_atomic" BIGINT NOT NULL,
  "percentage_fee_atomic" BIGINT NOT NULL,
  "percentage_fee_bps" INTEGER NOT NULL,
  "total_fee_atomic" BIGINT NOT NULL,
  "trade_amount_atomic" BIGINT NOT NULL,
  "spread_bps" INTEGER NOT NULL,
  "spread_amount_atomic" BIGINT NOT NULL,
  "destination_amount_atomic" BIGINT NOT NULL,
  "quote_fiat_decimals" INTEGER NOT NULL,
  "base_asset_decimals" INTEGER NOT NULL,
  "reference_rate" DECIMAL(60,30) NOT NULL,
  "customer_rate" DECIMAL(60,30) NOT NULL,
  "rate_display_scale" INTEGER NOT NULL,
  "fee_rounding_mode" "FeeRoundingMode" NOT NULL,
  "destination_rounding_mode" "DestinationRoundingMode" NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quotes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quotes_amounts_positive_check" CHECK ("total_debit_atomic" > 0 AND "trade_amount_atomic" > 0 AND "destination_amount_atomic" > 0),
  CONSTRAINT "quotes_fees_nonnegative_check" CHECK ("fixed_fee_atomic" >= 0 AND "percentage_fee_atomic" >= 0 AND "spread_amount_atomic" >= 0),
  CONSTRAINT "quotes_fee_sum_check" CHECK ("total_fee_atomic" = "fixed_fee_atomic" + "percentage_fee_atomic"),
  CONSTRAINT "quotes_debit_sum_check" CHECK ("total_debit_atomic" = "trade_amount_atomic" + "total_fee_atomic"),
  CONSTRAINT "quotes_percentage_fee_check" CHECK ("percentage_fee_bps" BETWEEN 0 AND 10000 AND "percentage_fee_atomic" = floor(("total_debit_atomic"::numeric * "percentage_fee_bps" + 9999) / 10000)::bigint),
  CONSTRAINT "quotes_spread_check" CHECK ("spread_bps" BETWEEN 0 AND 10000 AND "spread_amount_atomic" <= "trade_amount_atomic"),
  CONSTRAINT "quotes_decimals_check" CHECK ("quote_fiat_decimals" BETWEEN 0 AND 255 AND "base_asset_decimals" BETWEEN 0 AND 255),
  CONSTRAINT "quotes_rates_check" CHECK ("reference_rate" > 0 AND "customer_rate" > 0),
  CONSTRAINT "quotes_rate_scale_check" CHECK ("rate_display_scale" BETWEEN 0 AND 30),
  CONSTRAINT "quotes_expiry_check" CHECK ("expires_at" > "created_at")
);

CREATE INDEX "quotes_market_created_idx" ON "quotes" ("market_id", "created_at");
CREATE INDEX "quotes_expires_at_idx" ON "quotes" ("expires_at");

CREATE FUNCTION "protect_quote_policy_version"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'quote policy versions cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> 'ACTIVE'
    OR NEW."status" <> 'RETIRED'
    OR NEW."effective_until" IS NULL
    OR NEW."effective_until" <= OLD."effective_from"
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."market_id" IS DISTINCT FROM OLD."market_id"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."spread_bps" IS DISTINCT FROM OLD."spread_bps"
    OR NEW."fixed_fee_atomic" IS DISTINCT FROM OLD."fixed_fee_atomic"
    OR NEW."percentage_fee_bps" IS DISTINCT FROM OLD."percentage_fee_bps"
    OR NEW."min_total_debit_atomic" IS DISTINCT FROM OLD."min_total_debit_atomic"
    OR NEW."max_total_debit_atomic" IS DISTINCT FROM OLD."max_total_debit_atomic"
    OR NEW."quote_ttl_seconds" IS DISTINCT FROM OLD."quote_ttl_seconds"
    OR NEW."rate_display_scale" IS DISTINCT FROM OLD."rate_display_scale"
    OR NEW."configuration_version_id" IS DISTINCT FROM OLD."configuration_version_id"
    OR NEW."actor_id" IS DISTINCT FROM OLD."actor_id"
    OR NEW."reason" IS DISTINCT FROM OLD."reason"
    OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'quote policy economics are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "quote_policy_versions_protected" BEFORE UPDATE OR DELETE ON "quote_policy_versions" FOR EACH ROW EXECUTE FUNCTION "protect_quote_policy_version"();

CREATE FUNCTION "validate_quote_evidence"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  policy "quote_policy_versions"%ROWTYPE;
  snapshot_rate DECIMAL(60,30);
  snapshot_valid_until TIMESTAMPTZ(6);
  snapshot_market_id UUID;
  route_status "RegistryStatus";
  expected_network_id UUID;
  expected_asset_decimals INTEGER;
  expected_fiat_decimals INTEGER;
BEGIN
  SELECT * INTO policy FROM "quote_policy_versions" WHERE "id" = NEW."quote_policy_version_id";
  IF NOT FOUND OR policy."market_id" <> NEW."market_id"
    OR policy."status" <> 'ACTIVE'
    OR policy."effective_from" > NEW."created_at"
    OR policy."effective_until" IS NOT NULL THEN
    RAISE EXCEPTION 'quote policy is not active for market' USING ERRCODE = '23514';
  END IF;

  SELECT snapshot."rate", snapshot."valid_until", route."market_id", route."status"
    INTO snapshot_rate, snapshot_valid_until, snapshot_market_id, route_status
    FROM "reference_rate_snapshots" snapshot
    JOIN "conversion_routes" route ON route."id" = snapshot."route_id"
    WHERE snapshot."id" = NEW."reference_rate_snapshot_id" AND snapshot."status" = 'ACCEPTED';
  IF NOT FOUND OR snapshot_market_id <> NEW."market_id" OR route_status <> 'ENABLED'
    OR snapshot_valid_until IS NULL OR NEW."expires_at" > snapshot_valid_until THEN
    RAISE EXCEPTION 'quote reference snapshot is unavailable or expired' USING ERRCODE = '23514';
  END IF;

  SELECT market."default_backing_asset_network_id", asset."decimals", fiat."decimals"
    INTO expected_network_id, expected_asset_decimals, expected_fiat_decimals
    FROM "markets" market
    JOIN "asset_networks" backing ON backing."id" = market."default_backing_asset_network_id" AND backing."asset_id" = market."base_asset_id"
    JOIN "assets" asset ON asset."id" = market."base_asset_id"
    JOIN "fiat_currencies" fiat ON fiat."id" = market."quote_fiat_id"
    WHERE market."id" = NEW."market_id" AND market."status" = 'ENABLED'
      AND backing."status" = 'ENABLED' AND asset."status" = 'ENABLED' AND fiat."status" = 'ENABLED';
  IF NOT FOUND OR expected_network_id <> NEW."backing_asset_network_id"
    OR expected_asset_decimals <> NEW."base_asset_decimals"
    OR expected_fiat_decimals <> NEW."quote_fiat_decimals" THEN
    RAISE EXCEPTION 'quote market evidence does not match active configuration' USING ERRCODE = '23514';
  END IF;

  IF NEW."configuration_version_id" <> policy."configuration_version_id"
    OR NEW."spread_bps" <> policy."spread_bps"
    OR NEW."fixed_fee_atomic" <> policy."fixed_fee_atomic"
    OR NEW."percentage_fee_bps" <> policy."percentage_fee_bps"
    OR NEW."rate_display_scale" <> policy."rate_display_scale"
    OR NEW."total_debit_atomic" < policy."min_total_debit_atomic"
    OR NEW."total_debit_atomic" > policy."max_total_debit_atomic" THEN
    RAISE EXCEPTION 'quote values do not match policy evidence' USING ERRCODE = '23514';
  END IF;

  IF NEW."reference_rate" <> snapshot_rate
    OR NEW."customer_rate" <> round(snapshot_rate * (10000 + policy."spread_bps") / 10000, 30)
    OR NEW."expires_at" > NEW."created_at" + make_interval(secs => policy."quote_ttl_seconds") THEN
    RAISE EXCEPTION 'quote rate or expiry does not match evidence' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "quotes_evidence_check" BEFORE INSERT ON "quotes" FOR EACH ROW EXECUTE FUNCTION "validate_quote_evidence"();

CREATE FUNCTION "prevent_quote_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'quotes are immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "quotes_immutable" BEFORE UPDATE OR DELETE ON "quotes" FOR EACH ROW EXECUTE FUNCTION "prevent_quote_mutation"();
