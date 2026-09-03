-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('CREATED', 'POLICY_APPROVED', 'SUBMITTING', 'SUBMITTED', 'CANCELLED', 'REJECTED', 'SUBMISSION_UNKNOWN', 'FAILED_BEFORE_BROADCAST', 'RECONCILIATION_REQUIRED');

-- CreateEnum
CREATE TYPE "WithdrawalSubmissionJobStatus" AS ENUM ('PENDING', 'LEASED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WithdrawalPolicyStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "withdrawal_policy_versions" (
    "id" UUID NOT NULL,
    "asset_network_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "transfer_type" "NetworkTransferType" NOT NULL,
    "auto_approve_max_atomic" BIGINT NOT NULL,
    "max_fee_quote_age_seconds" INTEGER NOT NULL,
    "status" "WithdrawalPolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "configuration_version_id" INTEGER NOT NULL,
    "actor_id" VARCHAR(100) NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "fee_quote_id" UUID NOT NULL,
    "asset_network_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "customer_reference" VARCHAR(100) NOT NULL,
    "client_lock_reference" VARCHAR(100) NOT NULL,
    "client_reference" VARCHAR(100) NOT NULL,
    "destination_address" VARCHAR(255) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "principal_atomic" BIGINT NOT NULL,
    "total_debit_atomic" BIGINT NOT NULL,
    "external_tx_id" UUID NOT NULL,
    "provider_transfer_id" VARCHAR(100),
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'CREATED',
    "policy_approved_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "submitted_at" TIMESTAMPTZ(6),
    "failed_before_broadcast_at" TIMESTAMPTZ(6),
    "reconciliation_required_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_transitions" (
    "id" UUID NOT NULL,
    "withdrawal_id" UUID NOT NULL,
    "from_status" "WithdrawalStatus",
    "to_status" "WithdrawalStatus" NOT NULL,
    "reason_code" VARCHAR(100) NOT NULL,
    "correlation_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_submission_jobs" (
    "id" UUID NOT NULL,
    "withdrawal_id" UUID NOT NULL,
    "status" "WithdrawalSubmissionJobStatus" NOT NULL DEFAULT 'PENDING',
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "lease_token" UUID,
    "lease_expires_at" TIMESTAMPTZ(6),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "withdrawal_submission_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_policy_versions_asset_network_id_transfer_type__key" ON "withdrawal_policy_versions"("asset_network_id", "transfer_type", "version");

-- CreateIndex
CREATE INDEX "withdrawal_policy_versions_asset_network_id_transfer_type__idx" ON "withdrawal_policy_versions"("asset_network_id", "transfer_type", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_fee_quote_id_key" ON "withdrawals"("fee_quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_client_lock_reference_key" ON "withdrawals"("client_lock_reference");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_client_reference_key" ON "withdrawals"("client_reference");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_external_tx_id_key" ON "withdrawals"("external_tx_id");

-- CreateIndex
CREATE INDEX "withdrawals_asset_network_id_status_idx" ON "withdrawals"("asset_network_id", "status");

-- CreateIndex
CREATE INDEX "withdrawal_transitions_withdrawal_id_occurred_at_idx" ON "withdrawal_transitions"("withdrawal_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_submission_jobs_withdrawal_id_key" ON "withdrawal_submission_jobs"("withdrawal_id");

-- CreateIndex
CREATE INDEX "withdrawal_submission_jobs_status_due_at_idx" ON "withdrawal_submission_jobs"("status", "due_at");

-- AddForeignKey
ALTER TABLE "withdrawal_policy_versions" ADD CONSTRAINT "withdrawal_policy_versions_asset_network_id_fkey" FOREIGN KEY ("asset_network_id") REFERENCES "asset_networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_policy_versions" ADD CONSTRAINT "withdrawal_policy_versions_configuration_version_id_fkey" FOREIGN KEY ("configuration_version_id") REFERENCES "configuration_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_fee_quote_id_fkey" FOREIGN KEY ("fee_quote_id") REFERENCES "withdrawal_fee_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_asset_network_id_fkey" FOREIGN KEY ("asset_network_id") REFERENCES "asset_networks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "withdrawal_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_transitions" ADD CONSTRAINT "withdrawal_transitions_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_submission_jobs" ADD CONSTRAINT "withdrawal_submission_jobs_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Financial invariant: only one active withdrawal per fee quote (enforced by
-- the fee_quote_id unique index above) and immutable transition history.
CREATE FUNCTION "protect_withdrawal_history"() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'withdrawal history is immutable' USING ERRCODE = '23514'; END; $$;
CREATE TRIGGER "withdrawal_transitions_immutable" BEFORE UPDATE OR DELETE ON "withdrawal_transitions" FOR EACH ROW EXECUTE FUNCTION "protect_withdrawal_history"();

-- Only CREATED/POLICY_APPROVED may move to CANCELLED or REJECTED. Only
-- SUBMITTING may move to SUBMITTED, SUBMISSION_UNKNOWN, or
-- FAILED_BEFORE_BROADCAST. SUBMISSION_UNKNOWN may resolve to SUBMITTED,
-- FAILED_BEFORE_BROADCAST, or RECONCILIATION_REQUIRED. Terminal states
-- (SUBMITTED, CANCELLED, REJECTED, FAILED_BEFORE_BROADCAST) and identity,
-- quote linkage, references, and amounts cannot change once set.
CREATE FUNCTION "protect_withdrawal_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('SUBMITTED', 'CANCELLED', 'REJECTED', 'FAILED_BEFORE_BROADCAST')
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."fee_quote_id" IS DISTINCT FROM OLD."fee_quote_id"
    OR NEW."asset_network_id" IS DISTINCT FROM OLD."asset_network_id"
    OR NEW."customer_reference" IS DISTINCT FROM OLD."customer_reference"
    OR NEW."client_lock_reference" IS DISTINCT FROM OLD."client_lock_reference"
    OR NEW."client_reference" IS DISTINCT FROM OLD."client_reference"
    OR NEW."destination_address" IS DISTINCT FROM OLD."destination_address"
    OR NEW."correlation_id" IS DISTINCT FROM OLD."correlation_id"
    OR NEW."principal_atomic" IS DISTINCT FROM OLD."principal_atomic"
    OR NEW."total_debit_atomic" IS DISTINCT FROM OLD."total_debit_atomic"
    OR NEW."external_tx_id" IS DISTINCT FROM OLD."external_tx_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NOT (
      (OLD."status" = 'CREATED' AND NEW."status" IN ('POLICY_APPROVED', 'CANCELLED', 'REJECTED'))
      OR (OLD."status" = 'POLICY_APPROVED' AND NEW."status" IN ('SUBMITTING', 'CANCELLED', 'REJECTED'))
      OR (OLD."status" = 'SUBMITTING' AND NEW."status" IN ('SUBMITTED', 'SUBMISSION_UNKNOWN', 'FAILED_BEFORE_BROADCAST'))
      OR (OLD."status" = 'SUBMISSION_UNKNOWN' AND NEW."status" IN ('SUBMITTED', 'FAILED_BEFORE_BROADCAST', 'RECONCILIATION_REQUIRED'))
    ) THEN
    RAISE EXCEPTION 'invalid withdrawal mutation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "withdrawals_protected" BEFORE UPDATE ON "withdrawals" FOR EACH ROW EXECUTE FUNCTION "protect_withdrawal_update"();
CREATE TRIGGER "withdrawals_no_delete" BEFORE DELETE ON "withdrawals" FOR EACH ROW EXECUTE FUNCTION "protect_withdrawal_history"();
