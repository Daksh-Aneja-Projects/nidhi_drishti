-- 0006: full-text search and the invariant checks from docs/04 section 4.
--
-- The invariants are expressed as a queryable function rather than as
-- constraints, because most of them are *warnings about reality* rather than
-- errors: a cumulative series that dips is a genuine revision by the CGA, not
-- corrupt data, and it needs to be surfaced and explained, not rejected.

-- ---------------------------------------------------------------------------
-- Search. Postgres FTS is enough at this scale (a few hundred ministries and
-- schemes); Meilisearch only earns its keep once scheme coverage grows.
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_search_index AS
SELECT
  'ministry'::TEXT AS entity_type,
  m.ministry_id    AS entity_id,
  m.name,
  m.sector         AS context,
  setweight(to_tsvector('simple', m.name), 'A')
    || setweight(to_tsvector('simple', COALESCE(m.sector, '')), 'C')
    || setweight(to_tsvector('simple', COALESCE(string_agg(ea.alias, ' '), '')), 'B')
                   AS document
FROM ministry m
LEFT JOIN entity_alias ea
       ON ea.entity_type = 'ministry' AND ea.entity_id = m.ministry_id
WHERE m.active
GROUP BY m.ministry_id, m.name, m.sector

UNION ALL

SELECT
  'scheme'::TEXT,
  s.scheme_id,
  s.name,
  mi.name,
  setweight(to_tsvector('simple', s.name), 'A')
    || setweight(to_tsvector('simple', COALESCE(mi.name, '')), 'C')
    || setweight(to_tsvector('simple', COALESCE(string_agg(ea.alias, ' '), '')), 'B')
FROM scheme s
LEFT JOIN ministry mi ON mi.ministry_id = s.ministry_id
LEFT JOIN entity_alias ea
       ON ea.entity_type = 'scheme' AND ea.entity_id = s.scheme_id
WHERE s.active
GROUP BY s.scheme_id, s.name, mi.name;

CREATE UNIQUE INDEX mv_search_index_key ON mv_search_index (entity_type, entity_id);
CREATE INDEX mv_search_index_document_idx ON mv_search_index USING gin (document);
CREATE INDEX mv_search_index_name_trgm_idx ON mv_search_index USING gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Invariant checks. Run after every pipeline and surfaced on the ops page.
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

  -- 2. No fiscal fact without provenance. A NOT NULL foreign key already makes
  --    this unreachable; the check stays so that a future migration that
  --    weakens the column fails loudly here.
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

  -- 3. Cumulative series must not decrease within an FY. A dip means a source
  --    revised an earlier month downward, which is legitimate but must be
  --    visible rather than silently smoothed away.
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

  -- 5. Expenditure running far past the spending authority usually means an
  --    entity match went wrong or a unit was misread, so it is worth a look
  --    before it reaches a chart.
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

  -- 6. Any figure on screen that came from an illustrative row while the
  --    deployment claims to be serving live data.
  SELECT
    'illustrative_data_present',
    'warn',
    f.fy,
    f.entity_id,
    'Illustrative sample figure present. This deployment must run with DATA_MODE=demo.'
  FROM fiscal_fact f
  WHERE f.extraction_method = 'illustrative'
    AND (target_fy IS NULL OR f.fy = target_fy);
$$;

COMMENT ON FUNCTION check_invariants IS
  'docs/04 section 4 invariants. Severity error means broken data; warn means a '
  'real world condition that must be visible and explained, not suppressed.';
