CREATE OR REPLACE FUNCTION validate_accepted_snapshot_inputs() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_input_count INTEGER;
  supplied_input_count INTEGER;
  matching_input_count INTEGER;
  configured_guard_pair_id UUID;
  supplied_guard_pair_id UUID;
BEGIN
  IF NEW.status = 'ACCEPTED' THEN
    SELECT count(*) INTO expected_input_count
      FROM conversion_route_legs
      WHERE route_id = NEW.route_id;

    SELECT stablecoin_guard_pair_id INTO configured_guard_pair_id
      FROM conversion_routes
      WHERE id = NEW.route_id;

    SELECT count(*) INTO supplied_input_count
      FROM reference_rate_snapshot_inputs
      WHERE snapshot_id = NEW.id;

    SELECT count(*) INTO matching_input_count
      FROM conversion_route_legs leg
      JOIN reference_rate_snapshot_inputs input
        ON input.snapshot_id = NEW.id
       AND input.route_leg_id = leg.id
      JOIN price_observations observation
        ON observation.id = input.observation_id
       AND observation.provider_price_pair_id = leg.provider_price_pair_id
      WHERE leg.route_id = NEW.route_id;

    IF expected_input_count = 0
      OR supplied_input_count <> expected_input_count
      OR matching_input_count <> expected_input_count THEN
      RAISE EXCEPTION 'accepted snapshot must contain one matching observation for every route leg'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.guard_observation_id IS NOT NULL THEN
      SELECT provider_price_pair_id INTO supplied_guard_pair_id
        FROM price_observations WHERE id = NEW.guard_observation_id;
    END IF;
    IF configured_guard_pair_id IS DISTINCT FROM supplied_guard_pair_id THEN
      RAISE EXCEPTION 'accepted snapshot guard evidence must match route guard configuration'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
