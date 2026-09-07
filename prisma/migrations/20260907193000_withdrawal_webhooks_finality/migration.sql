ALTER TYPE "WithdrawalStatus" ADD VALUE 'BROADCASTED';
ALTER TYPE "WithdrawalStatus" ADD VALUE 'CONFIRMING';
ALTER TYPE "WithdrawalStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "WithdrawalStatus" ADD VALUE 'REPLACED';
ALTER TYPE "WithdrawalStatus" ADD VALUE 'FAILED_ON_CHAIN';

CREATE TYPE "CustodyWebhookStatus" AS ENUM ('VERIFIED_PENDING', 'LEASED', 'PROCESSED');
CREATE TYPE "WithdrawalTransactionAttemptStatus" AS ENUM ('SUBMITTED', 'BROADCASTED', 'CONFIRMING', 'REPLACED', 'CONFIRMED', 'FAILED_ON_CHAIN', 'RECONCILIATION_REQUIRED');
CREATE TYPE "WithdrawalEvidenceSource" AS ENUM ('FIREBLOCKS_WEBHOOK', 'FIREBLOCKS_POLL', 'CHAIN_RPC');
CREATE TYPE "WithdrawalFinalityJobStatus" AS ENUM ('PENDING', 'LEASED', 'COMPLETED');

ALTER TABLE "withdrawals"
  ADD COLUMN "broadcasted_at" TIMESTAMPTZ(6),
  ADD COLUMN "confirming_at" TIMESTAMPTZ(6),
  ADD COLUMN "confirmed_at" TIMESTAMPTZ(6),
  ADD COLUMN "replaced_at" TIMESTAMPTZ(6),
  ADD COLUMN "failed_on_chain_at" TIMESTAMPTZ(6);

CREATE TABLE "custody_webhook_inbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider_event_id" VARCHAR(150) NOT NULL,
  "event_type" VARCHAR(100) NOT NULL,
  "withdrawal_id" UUID,
  "raw_body" BYTEA NOT NULL,
  "payload_sha256" CHAR(64) NOT NULL,
  "signature_key_id" VARCHAR(150) NOT NULL,
  "signature_algorithm" VARCHAR(20) NOT NULL DEFAULT 'RS512',
  "status" "CustodyWebhookStatus" NOT NULL DEFAULT 'VERIFIED_PENDING',
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(100),
  "processed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "custody_webhook_inbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custody_webhook_inbox_provider_event_id_key" UNIQUE ("provider_event_id"),
  CONSTRAINT "custody_webhook_inbox_payload_sha256_shape" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "custody_webhook_inbox_signature_algorithm" CHECK ("signature_algorithm" = 'RS512'),
  CONSTRAINT "custody_webhook_inbox_lease_shape" CHECK (
    ("status" = 'LEASED' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("status" <> 'LEASED' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
  ),
  CONSTRAINT "custody_webhook_inbox_processed_shape" CHECK (
    ("status" = 'PROCESSED' AND "processed_at" IS NOT NULL)
    OR ("status" <> 'PROCESSED' AND "processed_at" IS NULL)
  )
);

CREATE TABLE "withdrawal_transaction_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "withdrawal_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "external_tx_id" VARCHAR(150) NOT NULL,
  "provider_transfer_id" VARCHAR(150),
  "request_hash" CHAR(64) NOT NULL,
  "status" "WithdrawalTransactionAttemptStatus" NOT NULL DEFAULT 'SUBMITTED',
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "replacement_of_id" UUID,
  "submitted_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "withdrawal_transaction_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "withdrawal_transaction_attempts_withdrawal_id_attempt_number_key" UNIQUE ("withdrawal_id", "attempt_number"),
  CONSTRAINT "withdrawal_transaction_attempts_external_tx_id_key" UNIQUE ("external_tx_id"),
  CONSTRAINT "withdrawal_transaction_attempts_provider_transfer_id_key" UNIQUE ("provider_transfer_id"),
  CONSTRAINT "withdrawal_transaction_attempts_attempt_number" CHECK ("attempt_number" > 0),
  CONSTRAINT "withdrawal_transaction_attempts_request_hash_shape" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "withdrawal_transaction_attempts_replacement_shape" CHECK (
    ("attempt_number" = 1 AND "replacement_of_id" IS NULL)
    OR ("attempt_number" > 1 AND "replacement_of_id" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "withdrawal_transaction_attempts_one_current"
  ON "withdrawal_transaction_attempts" ("withdrawal_id") WHERE "is_current";
CREATE INDEX "withdrawal_transaction_attempts_withdrawal_id_status_idx"
  ON "withdrawal_transaction_attempts" ("withdrawal_id", "status");

CREATE TABLE "withdrawal_transaction_hashes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "attempt_id" UUID NOT NULL,
  "tx_hash" VARCHAR(255) NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "withdrawal_transaction_hashes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "withdrawal_transaction_hashes_attempt_id_tx_hash_key" UNIQUE ("attempt_id", "tx_hash")
);
CREATE INDEX "withdrawal_transaction_hashes_tx_hash_idx" ON "withdrawal_transaction_hashes" ("tx_hash");

CREATE TABLE "withdrawal_finality_observations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "withdrawal_id" UUID NOT NULL,
  "attempt_id" UUID NOT NULL,
  "source" "WithdrawalEvidenceSource" NOT NULL,
  "provider_event_id" VARCHAR(150),
  "provider_status" VARCHAR(100),
  "tx_hash" VARCHAR(255),
  "block_hash" VARCHAR(255),
  "block_number" BIGINT,
  "confirmation_count" INTEGER,
  "execution_succeeded" BOOLEAN,
  "normalized_payload_hash" CHAR(64) NOT NULL,
  "observed_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "withdrawal_finality_observations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "withdrawal_finality_observations_source_normalized_payload_hash_key" UNIQUE ("source", "normalized_payload_hash"),
  CONSTRAINT "withdrawal_finality_observations_payload_hash_shape" CHECK ("normalized_payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "withdrawal_finality_observations_values" CHECK (
    ("block_number" IS NULL OR "block_number" >= 0)
    AND ("confirmation_count" IS NULL OR "confirmation_count" >= 0)
  )
);
CREATE INDEX "withdrawal_finality_observations_withdrawal_id_observed_at_idx" ON "withdrawal_finality_observations" ("withdrawal_id", "observed_at");
CREATE INDEX "withdrawal_finality_observations_attempt_id_observed_at_idx" ON "withdrawal_finality_observations" ("attempt_id", "observed_at");

CREATE TABLE "withdrawal_finality_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "withdrawal_id" UUID NOT NULL,
  "status" "WithdrawalFinalityJobStatus" NOT NULL DEFAULT 'PENDING',
  "due_at" TIMESTAMPTZ(6) NOT NULL,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(100),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "withdrawal_finality_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "withdrawal_finality_jobs_withdrawal_id_key" UNIQUE ("withdrawal_id"),
  CONSTRAINT "withdrawal_finality_jobs_lease_shape" CHECK (
    ("status" = 'LEASED' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("status" <> 'LEASED' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
  )
);
CREATE INDEX "withdrawal_finality_jobs_status_due_at_idx" ON "withdrawal_finality_jobs" ("status", "due_at");

ALTER TABLE "custody_webhook_inbox" ADD CONSTRAINT "custody_webhook_inbox_withdrawal_id_fkey"
  FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawal_transaction_attempts" ADD CONSTRAINT "withdrawal_transaction_attempts_withdrawal_id_fkey"
  FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawal_transaction_attempts" ADD CONSTRAINT "withdrawal_transaction_attempts_replacement_of_id_fkey"
  FOREIGN KEY ("replacement_of_id") REFERENCES "withdrawal_transaction_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawal_transaction_hashes" ADD CONSTRAINT "withdrawal_transaction_hashes_attempt_id_fkey"
  FOREIGN KEY ("attempt_id") REFERENCES "withdrawal_transaction_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawal_finality_observations" ADD CONSTRAINT "withdrawal_finality_observations_withdrawal_id_fkey"
  FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawal_finality_observations" ADD CONSTRAINT "withdrawal_finality_observations_attempt_id_fkey"
  FOREIGN KEY ("attempt_id") REFERENCES "withdrawal_transaction_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "withdrawal_finality_jobs" ADD CONSTRAINT "withdrawal_finality_jobs_withdrawal_id_fkey"
  FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "withdrawal_transaction_attempts" (
  "withdrawal_id", "attempt_number", "external_tx_id", "provider_transfer_id",
  "request_hash", "status", "is_current", "submitted_at", "updated_at"
)
SELECT "id", 1, "external_tx_id"::text, "provider_transfer_id",
  encode(sha256(convert_to("external_tx_id"::text, 'UTF8')), 'hex'),
  'SUBMITTED', true, COALESCE("submitted_at", "updated_at"), CURRENT_TIMESTAMP
FROM "withdrawals"
WHERE "status" = 'SUBMITTED';

INSERT INTO "withdrawal_finality_jobs" ("withdrawal_id", "due_at", "updated_at")
SELECT "id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "withdrawals"
WHERE "status" = 'SUBMITTED';

CREATE OR REPLACE FUNCTION "protect_append_only_withdrawal_evidence"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'withdrawal evidence records are append-only';
END;
$$;
CREATE TRIGGER "withdrawal_transaction_hashes_append_only"
  BEFORE UPDATE OR DELETE ON "withdrawal_transaction_hashes"
  FOR EACH ROW EXECUTE FUNCTION "protect_append_only_withdrawal_evidence"();
CREATE TRIGGER "withdrawal_finality_observations_append_only"
  BEFORE UPDATE OR DELETE ON "withdrawal_finality_observations"
  FOR EACH ROW EXECUTE FUNCTION "protect_append_only_withdrawal_evidence"();

CREATE OR REPLACE FUNCTION "protect_withdrawal_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('CONFIRMED', 'FAILED_ON_CHAIN', 'CANCELLED', 'REJECTED', 'FAILED_BEFORE_BROADCAST', 'RECONCILIATION_REQUIRED')
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
    OR (OLD."status" = 'SUBMITTED' AND NEW."status" IN ('BROADCASTED', 'CONFIRMING', 'CONFIRMED', 'REPLACED', 'FAILED_ON_CHAIN', 'RECONCILIATION_REQUIRED'))
    OR (OLD."status" = 'BROADCASTED' AND NEW."status" IN ('CONFIRMING', 'CONFIRMED', 'REPLACED', 'FAILED_ON_CHAIN', 'RECONCILIATION_REQUIRED'))
    OR (OLD."status" = 'CONFIRMING' AND NEW."status" IN ('CONFIRMED', 'REPLACED', 'FAILED_ON_CHAIN', 'RECONCILIATION_REQUIRED'))
    OR (OLD."status" = 'REPLACED' AND NEW."status" IN ('CONFIRMING', 'CONFIRMED', 'FAILED_ON_CHAIN', 'RECONCILIATION_REQUIRED'))
  ) THEN
    RAISE EXCEPTION 'invalid withdrawal status transition from % to %', OLD."status", NEW."status";
  END IF;

  RETURN NEW;
END;
$$;
