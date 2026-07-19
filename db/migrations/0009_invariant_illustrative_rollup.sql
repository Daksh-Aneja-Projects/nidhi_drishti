-- 0009: roll the illustrative-data invariant up to one finding per year.
--
-- The check in 0006 reported one row per illustrative fact, which on a loaded
-- sample dataset is several thousand identical warnings. A check that buries
-- its own output is a check nobody reads, and the signal here is simply "sample
-- figures are present in this year", so it is now counted rather than listed.

CREATE OR REPLACE FUNCTION check_invariants(target_fy TEXT DEFAULT NULL)
RETURNS TABLE (
  invariant   TEXT,
  severity    TEXT,
  fy          TEXT,
  entity_id   TEXT,
  detail      TEXT
) LANGUAGE sql STABLE AS $$
  -- 1. Ministry BE should roughly reconcile to the national BE. The residual is
  --    expected (transfers to states, interest, items outside a ministry
  --    demand), so this is informational and reports the size of the gap.
  SELECT
    'ministry_sum_vs_national_be',
    CASE WHEN ABS(ministry_sum_residual) > 0.25 * NULLIF(be, 0) THEN 'warn' ELSE 'info' END,
    n.fy,
    NULL,
    format('Ministry BE total differs from national BE by %s crore (%s%%)',
           ROUND(ministry_sum_residual, 2),
           ROUND(100 * ministry_sum_residual / NULLIF(be, 0), 1))
  FROM mv_national_summary n
  WHERE (target_fy IS NULL OR n.fy = target_fy)
    AND ministry_sum_residual IS NOT NULL

  UNION ALL

  -- 2. No fiscal fact without provenance.
  SELECT
    'fact_without_source',
    'error',
    f.fy,
    f.entity_id,
    format('fact_id %s has no source record', f.fact_id)
  FROM fiscal_fact f
  LEFT JOIN source_record sr ON sr.source_record_id = f.source_record_id
  WHERE sr.source_record_id IS NULL
    AND (target_fy IS NULL OR f.fy = target_fy)

  UNION ALL

  -- 3. Cumulative series must not decrease within an FY. A dip is a legitimate
  --    revision by the source, but it must be visible rather than smoothed away.
  SELECT
    'cumulative_series_decreased',
    'warn',
    ms.fy,
    ms.entity_id,
    format('%s cumulative expenditure fell by %s crore in fiscal month %s',
           ms.entity_id, ROUND(ABS(ms.monthly_amount), 2), ms.fiscal_month_index)
  FROM mv_monthly_spend ms
  WHERE ms.is_revision_artifact
    AND (target_fy IS NULL OR ms.fy = target_fy)

  UNION ALL

  -- 4. A superseded fact must never reach a view.
  SELECT
    'superseded_fact_visible',
    'error',
    v.fy,
    v.entity_id,
    format('fact_id %s is superseded but still visible', v.fact_id)
  FROM v_fiscal_fact_current v
  WHERE EXISTS (SELECT 1 FROM fiscal_fact s WHERE s.supersedes_fact_id = v.fact_id)
    AND (target_fy IS NULL OR v.fy = target_fy)

  UNION ALL

  -- 5. Expenditure far past the spending authority usually means an entity
  --    match went wrong or a unit was misread, so it is worth a look before it
  --    reaches a chart.
  SELECT
    'expenditure_exceeds_authority',
    'warn',
    m.fy,
    m.ministry_id,
    format('%s: expenditure %s crore against authority %s crore (%s%% of authority)',
           m.name, ROUND(m.expenditure_to_date, 2), ROUND(m.current_authority, 2),
           ROUND(m.pct_spent, 1))
  FROM mv_ministry_summary m
  WHERE m.pct_spent > 150
    AND (target_fy IS NULL OR m.fy = target_fy)

  UNION ALL

  -- 6. Illustrative figures present, counted per year rather than listed.
  SELECT
    'illustrative_data_present',
    'warn',
    f.fy,
    NULL,
    format('%s illustrative sample figures present across %s entities. '
           'This deployment must run with DATA_MODE=demo and must not be cited.',
           COUNT(*), COUNT(DISTINCT f.entity_id))
  FROM fiscal_fact f
  WHERE f.extraction_method = 'illustrative'
    AND (target_fy IS NULL OR f.fy = target_fy)
  GROUP BY f.fy;
$$;
