ALTER TABLE "price_observations"
  ADD COLUMN "sequence_gap" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "price_observations"
  ADD CONSTRAINT "price_observations_sequence_gap_check"
  CHECK (NOT "sequence_gap" OR "provider_sequence" IS NOT NULL);
