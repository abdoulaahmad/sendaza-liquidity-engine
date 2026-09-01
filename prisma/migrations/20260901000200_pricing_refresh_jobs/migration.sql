CREATE TYPE "PricingRefreshJobStatus" AS ENUM ('PENDING', 'LEASED');

CREATE TABLE "pricing_refresh_jobs" (
  "id" UUID PRIMARY KEY,
  "market_id" UUID NOT NULL UNIQUE REFERENCES "markets"("id") ON DELETE RESTRICT,
  "refresh_interval_seconds" INTEGER NOT NULL,
  "status" "PricingRefreshJobStatus" NOT NULL DEFAULT 'PENDING',
  "next_refresh_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_token" UUID,
  "lease_expires_at" TIMESTAMPTZ,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(100),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_refresh_jobs_interval_check" CHECK ("refresh_interval_seconds" BETWEEN 1 AND 86400),
  CONSTRAINT "pricing_refresh_jobs_attempt_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "pricing_refresh_jobs_lease_check" CHECK (
    ("status" = 'LEASED' AND "lease_token" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("status" = 'PENDING' AND "lease_token" IS NULL AND "lease_expires_at" IS NULL)
  )
);

CREATE INDEX "pricing_refresh_jobs_status_next_refresh_at_idx"
  ON "pricing_refresh_jobs" ("status", "next_refresh_at");
CREATE INDEX "pricing_refresh_jobs_lease_expires_at_idx"
  ON "pricing_refresh_jobs" ("lease_expires_at");
