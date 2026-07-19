-- 0007: include the search index in the refresh entry point.
--
-- mv_search_index is created in 0006, after the refresh function is defined in
-- 0005, so the function has to be redefined here to cover it. Without this a
-- newly seeded ministry is invisible to search until someone refreshes it by
-- hand, which is exactly the kind of quiet staleness this product exists to
-- avoid.

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
  EXECUTE format('REFRESH MATERIALIZED VIEW %s mv_search_index', mode);
END;
$$;
