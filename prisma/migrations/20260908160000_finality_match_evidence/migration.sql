ALTER TABLE "withdrawal_finality_observations"
  ADD COLUMN "destination_matches" BOOLEAN,
  ADD COLUMN "amount_matches" BOOLEAN,
  ADD COLUMN "asset_matches" BOOLEAN,
  ADD COLUMN "network_matches" BOOLEAN;

ALTER TABLE "withdrawal_finality_observations"
  ADD CONSTRAINT "withdrawal_finality_chain_match_shape" CHECK (
    "source" <> 'CHAIN_RPC'
    OR (
      "destination_matches" IS NOT NULL
      AND "amount_matches" IS NOT NULL
      AND "asset_matches" IS NOT NULL
      AND "network_matches" IS NOT NULL
    )
  );
