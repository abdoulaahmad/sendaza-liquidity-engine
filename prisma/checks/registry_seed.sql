DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM asset_networks AS asset_network
    JOIN assets AS asset ON asset.id = asset_network.asset_id
    WHERE asset.symbol = 'USDT'
  ) <> 2 THEN
    RAISE EXCEPTION 'expected exactly two USDT routes';
  END IF;
END
$$;
