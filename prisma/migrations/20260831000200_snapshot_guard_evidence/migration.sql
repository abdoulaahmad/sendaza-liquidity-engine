ALTER TABLE "reference_rate_snapshots"
  ADD COLUMN "guard_observation_id" UUID
  REFERENCES "price_observations"("id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION "validate_accepted_snapshot_inputs"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  route_leg_count INTEGER;
  valid_input_count INTEGER;
  configured_guard_pair_id UUID;
  supplied_guard_pair_id UUID;
BEGIN
  IF NEW."status" = 'ACCEPTED' THEN
    SELECT count(*), route."stablecoin_guard_pair_id"
      INTO route_leg_count, configured_guard_pair_id
      FROM "conversion_route_legs" leg
      RIGHT JOIN "conversion_routes" route ON route."id" = NEW."route_id"
      WHERE route."id" = NEW."route_id"
      GROUP BY route."stablecoin_guard_pair_id";

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

    IF NEW."guard_observation_id" IS NOT NULL THEN
      SELECT "provider_price_pair_id" INTO supplied_guard_pair_id
        FROM "price_observations" WHERE "id" = NEW."guard_observation_id";
    END IF;
    IF configured_guard_pair_id IS DISTINCT FROM supplied_guard_pair_id THEN
      RAISE EXCEPTION 'accepted snapshot guard evidence must match route guard configuration'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
