ALTER TABLE quotes
  ADD CONSTRAINT quotes_destination_calculation_check CHECK (
    destination_amount_atomic = floor(
      trade_amount_atomic::numeric * power(10::numeric, base_asset_decimals)
      / (customer_rate * power(10::numeric, quote_fiat_decimals))
    )::bigint
  ),
  ADD CONSTRAINT quotes_spread_calculation_check CHECK (
    spread_amount_atomic = floor(
      trade_amount_atomic::numeric
      - destination_amount_atomic::numeric * reference_rate
        * power(10::numeric, quote_fiat_decimals)
        / power(10::numeric, base_asset_decimals)
    )::bigint
  );
