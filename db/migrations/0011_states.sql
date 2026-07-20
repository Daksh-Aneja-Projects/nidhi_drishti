-- 0011: state budgets (v2 roadmap line). Karnataka, Odisha and the rest of the
-- states and union territories become first-class fiscal entities.
--
-- ===========================================================================
-- Decision 1: entity_type gains 'state' and 'state_department', rather than a
-- parallel set of state_fiscal_fact / state_* tables.
--
-- The reconciliation engine, five fiscal stages, provenance chain, revision
-- supersession, de-cumulation view and every invariant are all entity_type
-- agnostic already: they key on (entity_type, entity_id) and never assume the
-- type is a ministry. A state budget is exactly the same shape of data (BE and
-- RE authority, EXPENDITURE actuals, revenue/capital heads), so reusing
-- fiscal_fact means all of that machinery applies to states for free.
--
-- A parallel-tables design would fork the de-cumulation rule, the supersession
-- lineage and every invariant into a second copy that could drift from the
-- first, which is the exact anti-pattern this codebase fights everywhere (three
-- kept-identical FY implementations, one provenance path, one upsert).
--
-- The cost is one widened CHECK constraint per affected table, done below. It is
-- safe because the materialised summaries each filter by entity_type
-- (mv_ministry_summary WHERE 'ministry', mv_national_summary WHERE 'national',
-- mv_scheme_summary WHERE 'scheme'), so state rows landing in the shared base
-- views v_authority and v_expenditure_to_date never leak into a Union summary.
-- The new mv_state_summary filters WHERE 'state' the same way.
--
-- ===========================================================================
-- Decision 2: the CSS double-counting rule (the one that, got wrong, counts the
-- same rupee twice).
--
-- A Centrally Sponsored Scheme (for example the National Health Mission or
-- MGNREGA) is funded partly by the Centre and implemented by a state. The
-- Centre records its central share on the Union side as a scheme RELEASE, and
-- that same money reappears inside the state's accounts as receipts and
-- expenditure. Adding "Union scheme spend" to "state total spend" therefore
-- counts the central share twice: once when the Centre releases it and once when
-- the state spends it.
--
-- The rule this migration commits to:
--
--   * The Union scheme ledger (fiscal_fact rows with entity_type = 'scheme') is
--     central share only. mv_scheme_summary sums exactly those rows.
--   * A state's spending is recorded ONLY under entity_type in
--     ('state','state_department'). State scheme-level spending is never written
--     under entity_type = 'scheme', because mv_scheme_summary would sum it on
--     top of the Union central share for the same scheme.
--   * The Union national total (mv_national_summary) and the state totals
--     (mv_state_summary) are two distinct ledgers and are never summed into one
--     "Government of India" figure without netting out central transfers to
--     states. The product presents them side by side, not added together.
--
-- source_registry gains a `jurisdiction` column so a fact's ledger side is
-- knowable from its provenance, and the invariant `state_source_in_union_ledger`
-- (added to check_invariants below) fires the moment a state-sourced fact lands
-- in the scheme, ministry or national ledger. That is the check that catches a
-- CSS being counted in both a Union and a state total.
--
-- Decision 3: state fiscal years are April to March, identical to the Union, so
-- fy_start / fy_end / fy_fraction_elapsed and the fiscal_year table are reused
-- unchanged.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Reference: states and union territories.
-- ---------------------------------------------------------------------------
CREATE TABLE state (
  state_id        TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  -- 'state' has a legislature and its own budget by right; 'ut' is a union
  -- territory. Kept explicit because the two are governed and funded
  -- differently and the distinction matters for how a budget is even published.
  kind            TEXT NOT NULL CHECK (kind IN ('state', 'ut')),
  -- Editorial grouping for the dashboard, no official status, same idea as
  -- ministry.sector.
  region          TEXT,
  -- Several union territories have no legislative assembly and no budget of
  -- their own; their expenditure runs through the Union budget. Recording this
  -- keeps the UI from implying a treasury portal that does not exist.
  has_legislature BOOLEAN NOT NULL DEFAULT TRUE,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT state_id_shape CHECK (state_id ~ '^st-[a-z0-9-]+$')
);

CREATE INDEX state_kind_idx ON state (kind) WHERE active;
CREATE INDEX state_region_idx ON state (region) WHERE active;
CREATE INDEX state_name_trgm_idx ON state USING gin (name gin_trgm_ops);

-- Departments within a state, the state analogue of a Union ministry/demand.
-- The schema supports department-level state facts (entity_type =
-- 'state_department'); the initial Karnataka and Odisha pipelines target the
-- state aggregate, so this table is available for later department-level
-- ingestion rather than heavily seeded from unverified lists.
CREATE TABLE state_department (
  state_department_id TEXT PRIMARY KEY,
  state_id            TEXT NOT NULL REFERENCES state (state_id),
  name                TEXT NOT NULL,
  sector              TEXT,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT state_department_id_shape CHECK (state_department_id ~ '^std-[a-z0-9-]+$')
);

CREATE INDEX state_department_state_idx ON state_department (state_id) WHERE active;
CREATE INDEX state_department_name_trgm_idx ON state_department USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Widen the entity_type domains (Decision 1).
--
-- The constraints being replaced are the auto-named inline CHECKs from 0002 and
-- 0003. They are dropped and re-added by name so the new domain is explicit and
-- a future reader sees one definition, not two.
-- ---------------------------------------------------------------------------
ALTER TABLE fiscal_fact
  DROP CONSTRAINT fiscal_fact_entity_type_check,
  ADD  CONSTRAINT fiscal_fact_entity_type_check
    CHECK (entity_type IN ('ministry', 'scheme', 'national', 'state', 'state_department'));

-- Entity resolution needs to map "Government of Karnataka", "State of
-- Karnataka" and "Karnataka" onto st-karnataka, so the alias table has to accept
-- the two new types too.
ALTER TABLE entity_alias
  DROP CONSTRAINT entity_alias_entity_type_check,
  ADD  CONSTRAINT entity_alias_entity_type_check
    CHECK (entity_type IN ('ministry', 'scheme', 'demand', 'state', 'state_department'));

ALTER TABLE alias_review_queue
  DROP CONSTRAINT alias_review_queue_entity_type_check,
  ADD  CONSTRAINT alias_review_queue_entity_type_check
    CHECK (entity_type IN ('ministry', 'scheme', 'demand', 'state', 'state_department'));

-- ---------------------------------------------------------------------------
-- Ledger side of a source (Decision 2).
--
-- A fact sourced from a state treasury portal belongs to the state ledger; one
-- from a Union source belongs to the Union ledger. Existing sources default to
-- 'union', so the seed in 02 and every already-recorded fact keep their meaning
-- with no backfill.
-- ---------------------------------------------------------------------------
ALTER TABLE source_registry
  ADD COLUMN jurisdiction TEXT NOT NULL DEFAULT 'union'
    CHECK (jurisdiction IN ('union', 'state'));

-- ---------------------------------------------------------------------------
-- State summary, mirroring mv_ministry_summary.
--
-- Reads the shared v_authority and v_expenditure_to_date base views, so the
-- authority rule (RE over BE, plus supplementary) and the "latest cumulative
-- expenditure, never summed" rule are the same ones the Union side uses. No
-- balance or burn ratio is stored: both are derived here so a corrected input
-- cannot strand a stale derived figure (docs/04 invariant 4).
--
-- A state budget total blends the state's own revenue with central transfers it
-- receives. That is what the state itself presents, and it is correct as a
-- state figure; it simply must never be added to the Union total. The ledger
-- separation described in the header is what keeps that from happening.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_state_summary AS
SELECT
  a.fy,
  st.state_id,
  st.name,
  st.kind,
  st.region,
  a.be,
  a.re,
  a.supplementary,
  a.current_authority,
  e.expenditure_to_date,
  e.expenditure_as_of,
  e.expenditure_is_provisional,
  rev.expenditure_to_date AS revenue_expenditure,
  cap.expenditure_to_date AS capital_expenditure,
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
    OR COALESCE(e.expenditure_is_illustrative, FALSE) AS has_illustrative_source
FROM v_authority a
JOIN state st ON st.state_id = a.entity_id
LEFT JOIN v_expenditure_to_date e
       ON e.fy = a.fy AND e.entity_type = a.entity_type
      AND e.entity_id = a.entity_id AND e.head = 'total'
LEFT JOIN v_expenditure_to_date rev
       ON rev.fy = a.fy AND rev.entity_type = a.entity_type
      AND rev.entity_id = a.entity_id AND rev.head = 'revenue'
LEFT JOIN v_expenditure_to_date cap
       ON cap.fy = a.fy AND cap.entity_type = a.entity_type
      AND cap.entity_id = a.entity_id AND cap.head = 'capital'
WHERE a.entity_type = 'state';

CREATE UNIQUE INDEX mv_state_summary_key ON mv_state_summary (fy, state_id);
CREATE INDEX mv_state_summary_fy_idx ON mv_state_summary (fy);
CREATE INDEX mv_state_summary_region_idx ON mv_state_summary (fy, region);

-- ---------------------------------------------------------------------------
-- Fold the state summary into the refresh entry point.
--
-- Redefined in full (last defined in 0007) so the whole set stays in one place.
-- mv_state_summary is independent of the Union views, so its position in the
-- order does not matter; it is refreshed alongside the rest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_all_materialized_views(use_concurrent BOOLEAN DEFAULT TRUE)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  mode TEXT := CASE WHEN use_concurrent THEN 'CONCURRENTLY' ELSE '' END;
BEGIN
  EXECUTE format('REFRESH MATERIALIZED VIEW %s mv_monthly_spend', mode);
  -- The national summary reads the ministry summary, so ministry comes first.
  EXECUTE format('REFRESH MATERIALIZED VIEW %s mv_ministry_summary', mode);
  EXECUTE format('REFRESH MATERIALIZED VIEW %s mv_national_summary', mode);
  EXECUTE format('REFRESH MATERIALIZED VIEW %s mv_scheme_summary', mode);
  EXECUTE format('REFRESH MATERIALIZED VIEW %s mv_state_summary', mode);
  EXECUTE format('REFRESH MATERIALIZED VIEW %s mv_search_index', mode);
END;
$$;

-- ---------------------------------------------------------------------------
-- Invariants: carry forward the docs/04 set (last defined in 0009) and add the
-- state-specific checks, including the CSS double-count guard.
-- ---------------------------------------------------------------------------
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
  GROUP BY f.fy

  UNION ALL

  -- 7. The CSS double-count guard (Decision 2). A fact ingested from a state
  --    portal that has landed in the Union ledger (scheme, ministry or national)
  --    means a state's spending, very often a Centrally Sponsored Scheme's state
  --    share, is about to be summed on top of the Union figure for the same
  --    money. This is the one that catches a CSS being counted in both totals.
  --    An error, not a warning: it is wrong data, not stale data.
  SELECT
    'state_source_in_union_ledger',
    'error',
    f.fy,
    f.entity_id,
    format('fact_id %s (%s %s, stage %s) was ingested from state source %s but sits in the '
           'Union ledger as entity_type %s. State spending must be recorded under a state '
           'entity, or the Union and state totals both count the same rupee.',
           f.fact_id, f.entity_type, f.entity_id, f.stage, reg.source_id, f.entity_type)
  FROM fiscal_fact f
  JOIN source_record sr ON sr.source_record_id = f.source_record_id
  JOIN source_registry reg ON reg.source_id = sr.source_id
  WHERE reg.jurisdiction = 'state'
    AND f.entity_type IN ('ministry', 'scheme', 'national')
    AND (target_fy IS NULL OR f.fy = target_fy)

  UNION ALL

  -- 8. State referential integrity. fiscal_fact.entity_id is resolved through
  --    entity_alias rather than a foreign key (the same as ministries), so a
  --    state fact pointing at an unseeded state id is checked here rather than
  --    by the database, and is an error because it would render nowhere.
  SELECT
    'state_fact_unknown_state',
    'error',
    f.fy,
    f.entity_id,
    format('fact_id %s has entity_type state but entity_id %s is not a seeded state',
           f.fact_id, f.entity_id)
  FROM fiscal_fact f
  WHERE f.entity_type = 'state'
    AND NOT EXISTS (SELECT 1 FROM state s WHERE s.state_id = f.entity_id)
    AND (target_fy IS NULL OR f.fy = target_fy);
$$;

COMMENT ON FUNCTION check_invariants IS
  'docs/04 section 4 invariants plus the docs/12 state checks. Severity error '
  'means broken data (including a state-sourced fact in the Union ledger, which '
  'would double count a Centrally Sponsored Scheme); warn means a real world '
  'condition that must be visible and explained, not suppressed.';
