-- 0003: provenance and the fiscal fact table.
--
-- CLAUDE.md principle 1: no figure exists without a source_record. That is
-- enforced here with a NOT NULL foreign key rather than by convention, because
-- a convention would eventually lose an argument with a deadline.

CREATE TABLE pipeline_run (
  run_id      BIGSERIAL PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES source_registry (source_id),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','ok','drift_alert','failed')),
  metrics     JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_text  TEXT
);

CREATE INDEX pipeline_run_source_idx ON pipeline_run (source_id, started_at DESC);
CREATE INDEX pipeline_run_status_idx ON pipeline_run (status, started_at DESC);

-- One row per fetched artifact. The artifact itself lives in object storage,
-- immutable and content addressed, and is never deleted: it is the evidence
-- trail if a published figure is ever challenged (docs/08 section 5).
CREATE TABLE source_record (
  source_record_id BIGSERIAL PRIMARY KEY,
  source_id        TEXT NOT NULL REFERENCES source_registry (source_id),
  url              TEXT,
  artifact_key     TEXT NOT NULL,
  artifact_sha256  TEXT NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  -- The date the document itself claims, which is not the date we fetched it.
  -- Both are shown in the provenance popover.
  document_date    DATE,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_type     TEXT,
  byte_size        BIGINT,
  pipeline_run_id  BIGINT REFERENCES pipeline_run (run_id),
  -- Identical bytes fetched twice are the same record; the pipeline skips the
  -- re-parse rather than duplicating provenance.
  UNIQUE (source_id, artifact_sha256)
);

CREATE INDEX source_record_source_idx ON source_record (source_id, fetched_at DESC);
CREATE INDEX source_record_docdate_idx ON source_record (source_id, document_date DESC);

-- ---------------------------------------------------------------------------
-- Fiscal facts. Append only; a revision supersedes its predecessor rather than
-- overwriting it, so the history of what a source said and when stays intact.
-- ---------------------------------------------------------------------------

CREATE TABLE fiscal_fact (
  fact_id       BIGSERIAL PRIMARY KEY,
  fy            TEXT NOT NULL REFERENCES fiscal_year (fy),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('ministry','scheme','national')),
  entity_id     TEXT NOT NULL,
  stage         TEXT NOT NULL CHECK (stage IN
                  ('BE','RE','SUPPLEMENTARY','SANCTION','RELEASE','EXPENDITURE','UTILIZATION')),
  head          TEXT NOT NULL DEFAULT 'total' CHECK (head IN ('revenue','capital','total')),
  -- NULL period means an annual figure (BE, RE). Period-bearing stages carry
  -- the window the figure covers.
  period_start  DATE,
  period_end    DATE,
  -- CGA publishes April-to-date totals. Summing successive cumulative
  -- snapshots would multiply the year's spend several times over, so the flag
  -- is mandatory and the de-cumulation view keys off it.
  is_cumulative BOOLEAN NOT NULL DEFAULT FALSE,
  amount_inr_cr NUMERIC(20,2) NOT NULL,
  source_record_id BIGINT NOT NULL REFERENCES source_record (source_record_id),
  extraction_method TEXT NOT NULL DEFAULT 'manual_entry' CHECK (extraction_method IN
                  ('structured_api','csv_parse','html_table','pdf_table','pdf_text',
                   'agent_assisted','manual_entry','illustrative')),
  is_provisional BOOLEAN NOT NULL DEFAULT FALSE,
  supersedes_fact_id BIGINT REFERENCES fiscal_fact (fact_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fiscal_fact_period_ordered
    CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  -- Annual authority figures have no period; flow figures must have one.
  CONSTRAINT fiscal_fact_period_presence CHECK (
    (stage IN ('BE','RE','SUPPLEMENTARY') AND period_start IS NULL AND period_end IS NULL)
    OR (stage NOT IN ('BE','RE','SUPPLEMENTARY') AND period_end IS NOT NULL)
  ),
  -- Only period-bearing figures can be cumulative.
  CONSTRAINT fiscal_fact_cumulative_needs_period
    CHECK (NOT is_cumulative OR period_end IS NOT NULL),
  CONSTRAINT fiscal_fact_no_self_supersede
    CHECK (supersedes_fact_id IS NULL OR supersedes_fact_id <> fact_id)
);

-- Re-ingesting the same document must be idempotent. NULLS NOT DISTINCT makes
-- the annual (period-less) rows collide properly rather than duplicating.
CREATE UNIQUE INDEX fiscal_fact_natural_key
  ON fiscal_fact (fy, entity_type, entity_id, stage, head, period_start, period_end, source_record_id)
  NULLS NOT DISTINCT;

CREATE INDEX fiscal_fact_entity_idx ON fiscal_fact (entity_type, entity_id, fy, stage);
CREATE INDEX fiscal_fact_stage_idx  ON fiscal_fact (fy, stage, entity_type);
CREATE INDEX fiscal_fact_supersedes_idx ON fiscal_fact (supersedes_fact_id)
  WHERE supersedes_fact_id IS NOT NULL;

-- Rows a parser could not confidently interpret. They are held here rather than
-- guessed at: docs/04 section 5 forbids inferring a unit from context.
CREATE TABLE parse_error (
  parse_error_id BIGSERIAL PRIMARY KEY,
  source_record_id BIGINT REFERENCES source_record (source_record_id),
  pipeline_run_id  BIGINT REFERENCES pipeline_run (run_id),
  stage_hint     TEXT,
  raw_context    JSONB NOT NULL,
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','resolved','wontfix')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX parse_error_open_idx ON parse_error (created_at DESC) WHERE status = 'open';
