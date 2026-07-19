-- 0002: reference data. Ministries, schemes, the source registry, and the
-- entity-alias table that holds the product together across sources that all
-- spell the same ministry differently.

CREATE TABLE fiscal_year (
  fy         TEXT PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date   DATE NOT NULL,
  CONSTRAINT fiscal_year_shape CHECK (fy ~ '^FY[0-9]{4}$'),
  -- The row must agree with the SQL helpers, so a hand-inserted row cannot
  -- quietly introduce a second definition of the financial year.
  CONSTRAINT fiscal_year_start_matches CHECK (start_date = fy_start(fy)),
  CONSTRAINT fiscal_year_end_matches   CHECK (end_date   = fy_end(fy))
);

CREATE TABLE source_registry (
  source_id    TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  tier         SMALLINT NOT NULL CHECK (tier BETWEEN 1 AND 3),
  cadence      TEXT NOT NULL CHECK (cadence IN
                 ('daily','weekly','monthly','annual','per_session','ad_hoc')),
  method       TEXT NOT NULL,
  format       TEXT NOT NULL,
  homepage_url TEXT NOT NULL,
  -- docs/08: every source carries its licence note and, where robots.txt or
  -- terms sent us to a different route, the record of that decision.
  license_note TEXT NOT NULL,
  access_note  TEXT,
  -- Expected gap between successful runs. Staleness alerting fires at 2x this.
  expected_interval_hours INT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE ministry (
  ministry_id TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sector      TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT ministry_id_shape CHECK (ministry_id ~ '^min-[a-z0-9-]+$')
);

CREATE INDEX ministry_sector_idx ON ministry (sector) WHERE active;
CREATE INDEX ministry_name_trgm_idx ON ministry USING gin (name gin_trgm_ops);

CREATE TABLE scheme (
  scheme_id   TEXT PRIMARY KEY,
  ministry_id TEXT REFERENCES ministry (ministry_id),
  name        TEXT NOT NULL,
  scheme_type TEXT CHECK (scheme_type IN ('CSS','CS','other')),
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT scheme_id_shape CHECK (scheme_id ~ '^sch-[a-z0-9-]+$')
);

CREATE INDEX scheme_ministry_idx ON scheme (ministry_id) WHERE active;
CREATE INDEX scheme_name_trgm_idx ON scheme USING gin (name gin_trgm_ops);

-- Every raw name string ever seen maps to a stable id. This is what lets a
-- tender that says "Ministry of Jal Shakti, Dept of Drinking Water & Sanitation"
-- line up with the budget document's "Department of Drinking Water and
-- Sanitation". Confidence below 0.9 is queued for human review, never trusted.
CREATE TABLE entity_alias (
  alias       TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ministry','scheme','demand')),
  entity_id   TEXT NOT NULL,
  source_id   TEXT REFERENCES source_registry (source_id),
  confidence  NUMERIC(3,2) NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  -- How the alias was established, so a low-confidence machine guess is never
  -- mistaken for a hand-verified mapping.
  resolved_by TEXT NOT NULL DEFAULT 'seed'
                CHECK (resolved_by IN ('seed','exact','trigram','agent','human')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (alias, entity_type)
);

CREATE INDEX entity_alias_entity_idx ON entity_alias (entity_type, entity_id);
CREATE INDEX entity_alias_trgm_idx ON entity_alias USING gin (alias gin_trgm_ops);

-- Aliases the resolver could not settle. Feeds the admin review queue. Nothing
-- here reaches canonical data until a human resolves it.
CREATE TABLE alias_review_queue (
  queue_id      BIGSERIAL PRIMARY KEY,
  raw_name      TEXT NOT NULL,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('ministry','scheme','demand')),
  source_id     TEXT REFERENCES source_registry (source_id),
  suggestions   JSONB NOT NULL DEFAULT '[]'::JSONB,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','resolved','rejected')),
  resolved_to   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  UNIQUE (raw_name, entity_type)
);

CREATE INDEX alias_review_pending_idx ON alias_review_queue (created_at DESC)
  WHERE status = 'pending';
