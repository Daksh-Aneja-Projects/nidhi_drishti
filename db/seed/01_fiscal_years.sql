-- Fiscal years. The CHECK constraints on the table verify each row against the
-- SQL helpers, so a typo here fails the insert rather than quietly shifting the
-- financial year for the whole product.
INSERT INTO fiscal_year (fy, start_date, end_date)
SELECT fy, fy_start(fy), fy_end(fy)
FROM (
  SELECT 'FY' || y AS fy FROM generate_series(2016, 2032) AS y
) years
ON CONFLICT (fy) DO NOTHING;
