CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'LEASED', 'DELIVERED', 'QUARANTINED');

CREATE TABLE "service_credentials" (
  "id" UUID PRIMARY KEY,
  "client_id" VARCHAR(100) NOT NULL,
  "key_id" VARCHAR(100) NOT NULL UNIQUE,
  "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "valid_from" TIMESTAMPTZ NOT NULL,
  "valid_until" TIMESTAMPTZ,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_credentials_validity_check" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
  CONSTRAINT "service_credentials_revocation_check" CHECK (
    ("status" = 'ACTIVE' AND "revoked_at" IS NULL)
    OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL)
  )
);
CREATE INDEX "service_credentials_client_id_status_idx" ON "service_credentials" ("client_id", "status");

CREATE TABLE "authentication_nonces" (
  "id" UUID PRIMARY KEY,
  "credential_id" UUID NOT NULL REFERENCES "service_credentials"("id") ON DELETE RESTRICT,
  "nonce_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "authentication_nonces_credential_id_nonce_hash_key" UNIQUE ("credential_id", "nonce_hash")
);
CREATE INDEX "authentication_nonces_expires_at_idx" ON "authentication_nonces" ("expires_at");

CREATE TABLE "idempotency_records" (
  "id" UUID PRIMARY KEY,
  "client_id" VARCHAR(100) NOT NULL,
  "operation" VARCHAR(100) NOT NULL,
  "idempotency_key" VARCHAR(200) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "response_code" INTEGER,
  "response_body" JSONB,
  "correlation_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_records_client_operation_key_key" UNIQUE ("client_id", "operation", "idempotency_key"),
  CONSTRAINT "idempotency_records_completion_check" CHECK (
    ("status" = 'IN_PROGRESS' AND "response_code" IS NULL AND "response_body" IS NULL AND "completed_at" IS NULL)
    OR ("status" = 'COMPLETED' AND "response_code" IS NOT NULL AND "response_body" IS NOT NULL AND "completed_at" IS NOT NULL)
  )
);
CREATE INDEX "idempotency_records_status_created_at_idx" ON "idempotency_records" ("status", "created_at");

CREATE TABLE "outbox_events" (
  "id" UUID PRIMARY KEY,
  "aggregate_type" VARCHAR(100) NOT NULL,
  "aggregate_id" VARCHAR(100) NOT NULL,
  "event_type" VARCHAR(150) NOT NULL,
  "payload" JSONB NOT NULL,
  "correlation_id" UUID NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 10,
  "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "delivered_at" TIMESTAMPTZ,
  "quarantined_at" TIMESTAMPTZ,
  "last_error_code" VARCHAR(100),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_attempts_check" CHECK (
    "attempt_count" >= 0 AND "max_attempts" > 0 AND "attempt_count" <= "max_attempts"
  ),
  CONSTRAINT "outbox_events_lease_check" CHECK (
    ("status" = 'LEASED' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("status" <> 'LEASED' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
  ),
  CONSTRAINT "outbox_events_terminal_check" CHECK (
    ("status" = 'DELIVERED' AND "delivered_at" IS NOT NULL AND "quarantined_at" IS NULL)
    OR ("status" = 'QUARANTINED' AND "quarantined_at" IS NOT NULL AND "delivered_at" IS NULL)
    OR ("status" IN ('PENDING', 'LEASED') AND "delivered_at" IS NULL AND "quarantined_at" IS NULL)
  )
);
CREATE INDEX "outbox_events_status_next_attempt_at_idx" ON "outbox_events" ("status", "next_attempt_at");
CREATE INDEX "outbox_events_lease_expires_at_idx" ON "outbox_events" ("lease_expires_at");

CREATE TABLE "audit_logs" (
  "id" UUID PRIMARY KEY,
  "actor_type" VARCHAR(50) NOT NULL,
  "actor_id" VARCHAR(100) NOT NULL,
  "correlation_id" UUID NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "resource_type" VARCHAR(100) NOT NULL,
  "resource_id" VARCHAR(100),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "audit_logs_correlation_id_idx" ON "audit_logs" ("correlation_id");
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx"
  ON "audit_logs" ("resource_type", "resource_id", "created_at");
