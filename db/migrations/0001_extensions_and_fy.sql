-- 0001: extensions and fiscal-year primitives.
--
-- The FY helpers are defined in SQL as well as TypeScript because the
-- materialised views compute burn ratios in the database, and a second
-- implementation of "when does the Indian financial year start" drifting from
-- the first would corrupt every headline figure on the site. The TypeScript
-- tests in packages/core and the SQL tests in db/tests assert the same cases.

CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- fuzzy entity-alias matching
CREATE EXTENSION IF NOT EXISTS vector;        -- pgvector, evidence retrieval
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- digest() for content hashing

-- ---------------------------------------------------------------------------
-- Fiscal-year helpers. FY2026 = 2025-04-01 .. 2026-03-31 (labelled by end year).
-- ---------------------------------------------------------------------------

-- Every call inside these bodies is schema-qualified, and that is load bearing.
--
-- PostgreSQL 18 runs CREATE MATERIALIZED VIEW and REFRESH with a restricted
-- search_path, extending to matviews the protection CREATE INDEX already had.
-- It closes a real injection hole: without it, anyone able to create a function
-- in a schema earlier on the path has their code run by whoever refreshes the
-- view. The consequence here is that an unqualified call inside a function body
-- stops resolving while a matview is being built, and mv_ministry_summary fails
-- with "function fy_start(text) does not exist" on a database where fy_start
-- plainly exists and answers when called directly.
--
-- Qualified rather than given a `SET search_path` clause, because a function
-- carrying a SET clause cannot be inlined by the planner, and these are inlined
-- into every materialised view the site reads. Qualification keeps them
-- inlinable and is what the PostgreSQL documentation recommends for functions
-- used in indexes and materialised views.
CREATE OR REPLACE FUNCTION public.fy_end_year(fy TEXT) RETURNS INT
  LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  IF fy !~ '^FY[0-9]{4}$' THEN
    RAISE EXCEPTION 'Invalid fiscal year %, expected the form FY2026', fy;
  END IF;
  RETURN pg_catalog.substr(fy, 3)::INT;
END;
$$;

CREATE OR REPLACE FUNCTION public.fy_start(fy TEXT) RETURNS DATE
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT pg_catalog.make_date(public.fy_end_year(fy) - 1, 4, 1);
$$;

CREATE OR REPLACE FUNCTION public.fy_end(fy TEXT) RETURNS DATE
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT pg_catalog.make_date(public.fy_end_year(fy), 3, 31);
$$;

-- The FY a date belongs to. Jan/Feb/Mar belong to the FY labelled with the
-- current calendar year; April onward belongs to the next.
CREATE OR REPLACE FUNCTION fy_of(d DATE) RETURNS TEXT
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT 'FY' || (CASE WHEN EXTRACT(MONTH FROM d) <= 3
                       THEN EXTRACT(YEAR FROM d)
                       ELSE EXTRACT(YEAR FROM d) + 1 END)::INT::TEXT;
$$;

-- FY-relative quarter. Q1 is April to June, not January to March.
CREATE OR REPLACE FUNCTION fy_quarter(d DATE) RETURNS INT
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT (((EXTRACT(MONTH FROM d)::INT - 4 + 12) % 12) / 3) + 1;
$$;

-- Ordinal of the month within the FY: April = 1 .. March = 12. CGA publishes
-- April-first, so this is the correct sort key for monthly accounts.
CREATE OR REPLACE FUNCTION fy_month_index(d DATE) RETURNS INT
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT ((EXTRACT(MONTH FROM d)::INT - 4 + 12) % 12) + 1;
$$;

-- Fraction of the FY elapsed at as_of, in [0,1]. Day exact, so leap years are
-- handled; clamped at both ends so a date outside the FY cannot produce a
-- nonsensical burn ratio.
CREATE OR REPLACE FUNCTION public.fy_fraction_elapsed(fy TEXT, as_of DATE)
  RETURNS NUMERIC
  LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE
    WHEN as_of < public.fy_start(fy) THEN 0::NUMERIC
    WHEN as_of >= public.fy_end(fy)  THEN 1::NUMERIC
    ELSE ((as_of - public.fy_start(fy)) + 1)::NUMERIC
         / ((public.fy_end(fy) - public.fy_start(fy)) + 1)::NUMERIC
  END;
$$;
