-- 0005: derived views.
--
-- Every number the dashboard shows is computed here. Nothing in this file
-- stores a balance or a burn ratio (docs/04 invariant 4): they are derived on
-- read so that a corrected input cannot leave a stale derived figure behind.
--
-- Two rules run through all of it:
--   * superseded facts never appear (invariant 5);
--   * a missing figure stays NULL and never becomes 0, so "not reported" can
--     be told apart from "reported as nil" all the way to the screen.

-- ---------------------------------------------------------------------------
-- Base: the currently authoritative version of every fact.
-- ---------------------------------------------------------------------------
CREATE VIEW v_fiscal_fact_current AS
SELECT DISTINCT ON (f.fy, f.entity_type, f.entity_id, f.stage, f.head, f.period_start, f.period_end)
  f.fact_id,
  f.fy,
  f.entity_type,
  f.entity_id,
  f.stage,
  f.head,
  f.period_start,
  f.period_end,
  f.is_cumulative,
  f.amount_inr_cr,
  f.is_provisional,
  f.extraction_method,
  f.source_record_id,
  sr.source_id,
  sr.url            AS source_url,
  sr.artifact_key,
  sr.document_date,
  sr.fetched_at
FROM fiscal_fact f
JOIN source_record sr ON sr.source_record_id = f.source_record_id
-- A fact pointed at by another fact's supersedes_fact_id has been revised away.
WHERE NOT EXISTS (
  SELECT 1 FROM fiscal_fact newer WHERE newer.supersedes_fact_id = f.fact_id
)
-- Where two sources report the same cell, the more recent document wins.
ORDER BY f.fy, f.entity_type, f.entity_id, f.stage, f.head, f.period_start, f.period_end,
         sr.document_date DESC NULLS LAST, sr.fetched_at DESC, f.fact_id DESC;

-- ---------------------------------------------------------------------------
-- Authority: the live permission to spend.
--
-- RE replaces BE once it exists; supplementary grants add on top. Getting this
-- wrong is how a dashboard ends up accusing a ministry of overspending an
-- allocation that Parliament already raised.
-- ---------------------------------------------------------------------------
CREATE VIEW v_authority AS
SELECT
  fy,
  entity_type,
  entity_id,
  MAX(amount_inr_cr) FILTER (WHERE stage = 'BE')            AS be,
  MAX(amount_inr_cr) FILTER (WHERE stage = 'RE')            AS re,
  SUM(amount_inr_cr) FILTER (WHERE stage = 'SUPPLEMENTARY') AS supplementary,
  COALESCE(
    MAX(amount_inr_cr) FILTER (WHERE stage = 'RE'),
    MAX(amount_inr_cr) FILTER (WHERE stage = 'BE')
  ) + COALESCE(SUM(amount_inr_cr) FILTER (WHERE stage = 'SUPPLEMENTARY'), 0)
                                                            AS current_authority,
  (ARRAY_AGG(source_record_id ORDER BY
     CASE stage WHEN 'RE' THEN 0 WHEN 'BE' THEN 1 ELSE 2 END,
     document_date DESC NULLS LAST))[1]                     AS authority_source_record_id,
  BOOL_OR(extraction_method = 'illustrative')                AS authority_is_illustrative
FROM v_fiscal_fact_current
WHERE stage IN ('BE','RE','SUPPLEMENTARY')
  AND head = 'total'
GROUP BY fy, entity_type, entity_id;

-- ---------------------------------------------------------------------------
-- Expenditure to date: the newest cumulative CGA figure for each entity.
--
-- Cumulative snapshots must never be summed, so this picks the single latest
-- one rather than aggregating.
-- ---------------------------------------------------------------------------
CREATE VIEW v_expenditure_to_date AS
SELECT DISTINCT ON (fy, entity_type, entity_id, head)
  fy,
  entity_type,
  entity_id,
  head,
  amount_inr_cr    AS expenditure_to_date,
  period_end       AS expenditure_as_of,
  is_provisional   AS expenditure_is_provisional,
  source_record_id AS expenditure_source_record_id,
  extraction_method = 'illustrative' AS expenditure_is_illustrative
FROM v_fiscal_fact_current
WHERE stage = 'EXPENDITURE'
  AND is_cumulative
ORDER BY fy, entity_type, entity_id, head, period_end DESC;

-- ---------------------------------------------------------------------------
-- Monthly spend, de-cumulated.
--
-- monthly = cumulative(m) - cumulative(m-1). Negative results are revisions and
-- are kept and flagged, never clamped: clamping would inflate the annual total
-- and hide the revision (docs/04 section 3).
--
-- LAG is taken over the ordered series of *reported* months, and the month
-- ordinal gap is checked, so a missing month yields NULL for the following
-- month instead of piling two months of spend onto one bar.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_monthly_spend AS
WITH cumulative AS (
  SELECT
    fy,
    entity_type,
    entity_id,
    period_end,
    fy_month_index(period_end)  AS fiscal_month_index,
    amount_inr_cr               AS cumulative_amount,
    is_provisional,
    source_record_id,
    extraction_method = 'illustrative' AS is_illustrative
  FROM v_fiscal_fact_current
  WHERE stage = 'EXPENDITURE'
    AND head = 'total'
    AND is_cumulative
),
lagged AS (
  SELECT
    c.*,
    LAG(cumulative_amount) OVER w  AS prev_amount,
    LAG(fiscal_month_index) OVER w AS prev_month_index
  FROM cumulative c
  WINDOW w AS (PARTITION BY fy, entity_type, entity_id ORDER BY fiscal_month_index)
)
SELECT
  fy,
  entity_type,
  entity_id,
  period_end,
  fiscal_month_index,
  DATE_TRUNC('month', period_end)::DATE AS period_start,
  cumulative_amount,
  CASE
    -- April is the first month of the year, so its cumulative figure is also
    -- its monthly figure.
    WHEN prev_month_index IS NULL AND fiscal_month_index = 1 THEN cumulative_amount
    -- A gap in the series makes the next month unrecoverable.
    WHEN prev_month_index IS NULL THEN NULL
    WHEN fiscal_month_index - prev_month_index <> 1 THEN NULL
    ELSE cumulative_amount - prev_amount
  END AS monthly_amount,
  CASE
    WHEN prev_month_index IS NULL AND fiscal_month_index = 1 THEN cumulative_amount < 0
    WHEN prev_month_index IS NULL THEN FALSE
    WHEN fiscal_month_index - prev_month_index <> 1 THEN FALSE
    ELSE (cumulative_amount - prev_amount) < 0
  END AS is_revision_artifact,
  is_provisional,
  source_record_id,
  is_illustrative
FROM lagged;

CREATE UNIQUE INDEX mv_monthly_spend_key
  ON mv_monthly_spend (fy, entity_type, entity_id, fiscal_month_index);
CREATE INDEX mv_monthly_spend_entity_idx
  ON mv_monthly_spend (entity_type, entity_id, fy, fiscal_month_index);

-- ---------------------------------------------------------------------------
-- Ministry summary.
--
-- pct_fy_elapsed is measured at the date the expenditure figure covers, not at
-- today's date. CGA accounts run roughly two months behind, so comparing
-- June's spend against November's calendar would show every ministry in the
-- country as badly behind schedule. The honest comparison is like for like.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_ministry_summary AS
SELECT
  a.fy,
  m.ministry_id,
  m.name,
  m.sector,
  a.be,
  a.re,
  a.supplementary,
  a.current_authority,
  e.expenditure_to_date,
  e.expenditure_as_of,
  e.expenditure_is_provisional,
  rev.expenditure_to_date AS revenue_expenditure,
  cap.expenditure_to_date AS capital_expenditure,
  -- Balance is authority minus spend; NULL on either side keeps it NULL.
  a.current_authority - e.expenditure_to_date AS balance,
  CASE WHEN a.current_authority > 0
       THEN 100 * e.expenditure_to_date / a.current_authority END AS pct_spent,
  CASE WHEN e.expenditure_as_of IS NOT NULL
       THEN 100 * fy_fraction_elapsed(a.fy, e.expenditure_as_of) END AS pct_fy_elapsed,
  CASE WHEN a.current_authority > 0
        AND e.expenditure_as_of IS NOT NULL
        AND fy_fraction_elapsed(a.fy, e.expenditure_as_of) > 0
       THEN (e.expenditure_to_date / a.current_authority)
            / fy_fraction_elapsed(a.fy, e.expenditure_as_of) END AS burn_ratio,
  a.authority_source_record_id,
  e.expenditure_source_record_id,
  COALESCE(a.authority_is_illustrative, FALSE)
    OR COALESCE(e.expenditure_is_illustrative, FALSE) AS has_illustrative_source,
  COALESCE(f.open_flag_count, 0) AS open_flag_count
FROM v_authority a
JOIN ministry m ON m.ministry_id = a.entity_id
LEFT JOIN v_expenditure_to_date e
       ON e.fy = a.fy AND e.entity_type = a.entity_type
      AND e.entity_id = a.entity_id AND e.head = 'total'
LEFT JOIN v_expenditure_to_date rev
       ON rev.fy = a.fy AND rev.entity_type = a.entity_type
      AND rev.entity_id = a.entity_id AND rev.head = 'revenue'
LEFT JOIN v_expenditure_to_date cap
       ON cap.fy = a.fy AND cap.entity_type = a.entity_type
      AND cap.entity_id = a.entity_id AND cap.head = 'capital'
LEFT JOIN (
  SELECT fy, entity_id, COUNT(*) AS open_flag_count
  FROM anomaly_flag
  WHERE entity_type = 'ministry' AND status = 'approved'
  GROUP BY fy, entity_id
) f ON f.fy = a.fy AND f.entity_id = a.entity_id
WHERE a.entity_type = 'ministry';

CREATE UNIQUE INDEX mv_ministry_summary_key ON mv_ministry_summary (fy, ministry_id);
CREATE INDEX mv_ministry_summary_fy_idx ON mv_ministry_summary (fy);

-- ---------------------------------------------------------------------------
-- National summary.
--
-- ministry_sum_residual surfaces the gap between the sum of ministry
-- allocations and the national total. A non-zero residual is expected, mostly
-- transfers to states and interest payments that sit outside a ministry demand.
-- It is published rather than hidden, because a reader who adds up the ministry
-- column and gets a different number deserves an explanation, not a silent
-- reconciliation (docs/04 invariant 1).
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_national_summary AS
WITH ministry_totals AS (
  SELECT fy, SUM(be) AS ministry_be_sum, COUNT(*) AS ministry_count
  FROM mv_ministry_summary
  GROUP BY fy
)
SELECT
  a.fy,
  a.be,
  a.re,
  a.supplementary,
  a.current_authority,
  e.expenditure_to_date,
  e.expenditure_as_of,
  e.expenditure_is_provisional,
  a.current_authority - e.expenditure_to_date AS balance,
  CASE WHEN a.current_authority > 0
       THEN 100 * e.expenditure_to_date / a.current_authority END AS pct_spent,
  CASE WHEN e.expenditure_as_of IS NOT NULL
       THEN 100 * fy_fraction_elapsed(a.fy, e.expenditure_as_of) END AS pct_fy_elapsed,
  CASE WHEN a.current_authority > 0
        AND e.expenditure_as_of IS NOT NULL
        AND fy_fraction_elapsed(a.fy, e.expenditure_as_of) > 0
       THEN (e.expenditure_to_date / a.current_authority)
            / fy_fraction_elapsed(a.fy, e.expenditure_as_of) END AS burn_ratio,
  COALESCE(t.ministry_count, 0) AS ministry_count,
  t.ministry_be_sum - a.be AS ministry_sum_residual,
  a.authority_source_record_id,
  e.expenditure_source_record_id,
  COALESCE(a.authority_is_illustrative, FALSE)
    OR COALESCE(e.expenditure_is_illustrative, FALSE) AS has_illustrative_source
FROM v_authority a
LEFT JOIN v_expenditure_to_date e
       ON e.fy = a.fy AND e.entity_type = 'national'
      AND e.entity_id = a.entity_id AND e.head = 'total'
LEFT JOIN ministry_totals t ON t.fy = a.fy
WHERE a.entity_type = 'national';

CREATE UNIQUE INDEX mv_national_summary_key ON mv_national_summary (fy);

-- ---------------------------------------------------------------------------
-- Scheme summary.
--
-- Allocation, releases and utilisation are three different stages and are kept
-- in three columns. A scheme with no reported utilisation shows NULL here and
-- "Not reported" on screen; rendering it as zero would invent a finding.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_scheme_summary AS
WITH scheme_facts AS (
  SELECT
    fy,
    entity_id AS scheme_id,
    MAX(amount_inr_cr) FILTER (WHERE stage IN ('BE','RE')
      AND stage = 'RE')                                   AS re,
    MAX(amount_inr_cr) FILTER (WHERE stage = 'BE')        AS be,
    SUM(amount_inr_cr) FILTER (WHERE stage = 'RELEASE'
      AND NOT is_cumulative)                              AS released_sum,
    MAX(amount_inr_cr) FILTER (WHERE stage = 'RELEASE'
      AND is_cumulative)                                  AS released_cumulative,
    MAX(amount_inr_cr) FILTER (WHERE stage = 'UTILIZATION') AS utilized,
    (ARRAY_AGG(source_record_id ORDER BY
       CASE stage WHEN 'RE' THEN 0 WHEN 'BE' THEN 1 ELSE 2 END))[1]
                                                          AS allocation_source_record_id,
    (ARRAY_AGG(source_record_id) FILTER (WHERE stage = 'RELEASE'))[1]
                                                          AS release_source_record_id,
    (ARRAY_AGG(source_record_id) FILTER (WHERE stage = 'UTILIZATION'))[1]
                                                          AS utilization_source_record_id,
    BOOL_OR(extraction_method = 'illustrative')           AS has_illustrative_source
  FROM v_fiscal_fact_current
  WHERE entity_type = 'scheme'
  GROUP BY fy, entity_id
),
tender_rollup AS (
  SELECT
    fy_of(published_date) AS fy,
    scheme_id,
    COUNT(*)              AS tender_count,
    SUM(value_inr_cr)     AS tender_value
  FROM tender
  WHERE scheme_id IS NOT NULL AND published_date IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  sf.fy,
  s.scheme_id,
  s.name,
  s.ministry_id,
  m.name AS ministry_name,
  s.scheme_type,
  COALESCE(sf.re, sf.be)                              AS allocation,
  -- Cumulative release snapshots are not summed; a cumulative figure wins over
  -- a set of periodic ones because PFMS publishes it as the year to date.
  COALESCE(sf.released_cumulative, sf.released_sum)   AS released,
  sf.utilized,
  CASE WHEN COALESCE(sf.re, sf.be) > 0 AND sf.utilized IS NOT NULL
       THEN 100 * sf.utilized / COALESCE(sf.re, sf.be) END AS utilization_pct,
  COALESCE(tr.tender_count, 0)                        AS tender_count,
  tr.tender_value,
  sf.allocation_source_record_id,
  sf.release_source_record_id,
  sf.utilization_source_record_id,
  COALESCE(sf.has_illustrative_source, FALSE)         AS has_illustrative_source
FROM scheme_facts sf
JOIN scheme s ON s.scheme_id = sf.scheme_id
LEFT JOIN ministry m ON m.ministry_id = s.ministry_id
LEFT JOIN tender_rollup tr ON tr.fy = sf.fy AND tr.scheme_id = sf.scheme_id;

CREATE UNIQUE INDEX mv_scheme_summary_key ON mv_scheme_summary (fy, scheme_id);
CREATE INDEX mv_scheme_summary_ministry_idx ON mv_scheme_summary (fy, ministry_id);

-- ---------------------------------------------------------------------------
-- Source freshness, for the bar that sits on every page.
-- ---------------------------------------------------------------------------
CREATE VIEW v_source_freshness AS
SELECT
  s.source_id,
  s.name,
  s.tier,
  s.cadence,
  s.expected_interval_hours,
  latest_doc.document_date AS latest_document_date,
  last_ok.finished_at      AS last_fetched_at,
  last_any.status          AS last_run_status,
  EXTRACT(EPOCH FROM (now() - last_ok.finished_at)) / 3600 AS hours_since_fetch,
  -- docs/09: stale once the gap passes twice the expected cadence. A source
  -- that has never run successfully counts as stale, not as fresh.
  (last_ok.finished_at IS NULL
   OR now() - last_ok.finished_at > (s.expected_interval_hours * 2) * INTERVAL '1 hour')
                           AS is_stale
FROM source_registry s
LEFT JOIN LATERAL (
  SELECT MAX(document_date) AS document_date
  FROM source_record sr WHERE sr.source_id = s.source_id
) latest_doc ON TRUE
LEFT JOIN LATERAL (
  SELECT finished_at FROM pipeline_run pr
  WHERE pr.source_id = s.source_id AND pr.status = 'ok'
  ORDER BY finished_at DESC NULLS LAST LIMIT 1
) last_ok ON TRUE
LEFT JOIN LATERAL (
  SELECT status FROM pipeline_run pr
  WHERE pr.source_id = s.source_id
  ORDER BY started_at DESC LIMIT 1
) last_any ON TRUE
WHERE s.active;

-- ---------------------------------------------------------------------------
-- Refresh entry point, called at the end of every pipeline run.
--
-- CONCURRENTLY needs the unique indexes declared above and avoids taking the
-- site offline mid-refresh. The dependency order matters: the national summary
-- reads the ministry summary.
-- ---------------------------------------------------------------------------
-- The parameter is not called "concurrently": that is a reserved keyword and
-- using it here is a syntax error inside the function body.
CREATE OR REPLACE FUNCTION refresh_all_materialized_views(use_concurrent BOOLEAN DEFAULT TRUE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  mode TEXT := CASE WHEN use_concurrent THEN 'CONCURRENTLY' ELSE '' END;
BEGIN
  EXECUTE format('REFRESH MATERIALIZED VIEW %s mv_monthly_spend', mode);
  EXECUTE format('REFRESH MATERIALIZED VIEW %s mv_ministry_summary', mode);
  EXECUTE format('REFRESH MATERIALIZED VIEW %s mv_national_summary', mode);
  EXECUTE format('REFRESH MATERIALIZED VIEW %s mv_scheme_summary', mode);
END;
$$;
