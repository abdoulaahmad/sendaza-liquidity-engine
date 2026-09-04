-- Bind every withdrawal to the exact server-selected custody route used for submission.
ALTER TABLE "withdrawals" ADD COLUMN "treasury_wallet_id" UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM withdrawals withdrawal
    WHERE (
      SELECT COUNT(*)
      FROM treasury_wallets wallet
      JOIN custody_providers provider ON provider.id = wallet.custody_provider_id
      WHERE wallet.asset_network_id = withdrawal.asset_network_id
        AND wallet.role = 'PRIMARY'
        AND wallet.status = 'ENABLED'
        AND provider.status = 'ENABLED'
        AND provider.type = 'FIREBLOCKS'
    ) <> 1
  ) THEN
    RAISE EXCEPTION 'Every existing withdrawal must resolve to exactly one enabled Fireblocks PRIMARY wallet';
  END IF;
END $$;

UPDATE withdrawals withdrawal
SET treasury_wallet_id = (
  SELECT wallet.id
  FROM treasury_wallets wallet
  JOIN custody_providers provider ON provider.id = wallet.custody_provider_id
  WHERE wallet.asset_network_id = withdrawal.asset_network_id
    AND wallet.role = 'PRIMARY'
    AND wallet.status = 'ENABLED'
    AND provider.status = 'ENABLED'
    AND provider.type = 'FIREBLOCKS'
);

ALTER TABLE "withdrawals" ALTER COLUMN "treasury_wallet_id" SET NOT NULL;
ALTER TABLE "withdrawals"
  ADD CONSTRAINT "withdrawals_treasury_wallet_id_fkey"
  FOREIGN KEY ("treasury_wallet_id") REFERENCES "treasury_wallets"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "withdrawals_treasury_wallet_id_idx" ON "withdrawals"("treasury_wallet_id");

-- The MVP permits one enabled primary route for each asset-network.
CREATE UNIQUE INDEX "treasury_wallets_one_enabled_primary_per_asset_network"
  ON "treasury_wallets"("asset_network_id")
  WHERE "role" = 'PRIMARY' AND "status" = 'ENABLED';

ALTER TABLE "withdrawals"
  ADD CONSTRAINT "withdrawals_positive_amounts"
  CHECK ("principal_atomic" > 0 AND "total_debit_atomic" >= "principal_atomic");

ALTER TABLE "withdrawal_policy_versions"
  ADD COLUMN "daily_customer_limit_atomic" BIGINT,
  ADD COLUMN "daily_customer_count_limit" INTEGER,
  ADD COLUMN "allow_first_time_destination" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "withdrawal_policy_versions"
  ADD CONSTRAINT "withdrawal_policy_values_valid"
  CHECK (
    "auto_approve_max_atomic" >= 0
    AND "max_fee_quote_age_seconds" > 0
    AND ("daily_customer_limit_atomic" IS NULL OR "daily_customer_limit_atomic" > 0)
    AND ("daily_customer_count_limit" IS NULL OR "daily_customer_count_limit" > 0)
  );

ALTER TABLE "withdrawal_submission_jobs"
  ADD CONSTRAINT "withdrawal_submission_job_lease_shape"
  CHECK (
    ("status" = 'LEASED' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR
    ("status" <> 'LEASED' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
  );

CREATE OR REPLACE FUNCTION "protect_withdrawal_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('SUBMITTED', 'CANCELLED', 'REJECTED', 'FAILED_BEFORE_BROADCAST', 'RECONCILIATION_REQUIRED')
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal withdrawal records are immutable';
  END IF;

  IF NEW."fee_quote_id" <> OLD."fee_quote_id"
     OR NEW."asset_network_id" <> OLD."asset_network_id"
     OR NEW."treasury_wallet_id" <> OLD."treasury_wallet_id"
     OR NEW."policy_id" <> OLD."policy_id"
     OR NEW."customer_reference" <> OLD."customer_reference"
     OR NEW."client_lock_reference" <> OLD."client_lock_reference"
     OR NEW."client_reference" <> OLD."client_reference"
     OR NEW."destination_address" <> OLD."destination_address"
     OR NEW."principal_atomic" <> OLD."principal_atomic"
     OR NEW."total_debit_atomic" <> OLD."total_debit_atomic"
     OR NEW."external_tx_id" <> OLD."external_tx_id" THEN
    RAISE EXCEPTION 'withdrawal identity and financial evidence are immutable';
  END IF;

  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'CREATED' AND NEW."status" IN ('POLICY_APPROVED', 'CANCELLED', 'REJECTED'))
    OR (OLD."status" = 'POLICY_APPROVED' AND NEW."status" IN ('SUBMITTING', 'CANCELLED', 'REJECTED'))
    OR (OLD."status" = 'SUBMITTING' AND NEW."status" IN ('SUBMITTED', 'SUBMISSION_UNKNOWN', 'FAILED_BEFORE_BROADCAST', 'RECONCILIATION_REQUIRED'))
    OR (OLD."status" = 'SUBMISSION_UNKNOWN' AND NEW."status" IN ('SUBMITTED', 'FAILED_BEFORE_BROADCAST', 'RECONCILIATION_REQUIRED'))
  ) THEN
    RAISE EXCEPTION 'invalid withdrawal status transition from % to %', OLD."status", NEW."status";
  END IF;

  RETURN NEW;
END;
$$;
