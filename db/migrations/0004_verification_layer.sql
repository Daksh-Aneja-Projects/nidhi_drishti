-- 0004: the verification layer. Tenders, evidence, anomaly flags and agent
-- narratives.
--
-- Hard rule from docs/05: agents write here and nowhere else. Nothing in this
-- migration touches fiscal_fact, and nothing here is ever treated as a fiscal
-- figure. Tier 2 signals answer "is the money turning into observable
-- activity", which is a different and weaker question than "how much was spent".

CREATE TABLE tender (
  tender_id      TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  org_raw        TEXT NOT NULL,
  ministry_id    TEXT REFERENCES ministry (ministry_id),
  scheme_id      TEXT REFERENCES scheme (scheme_id),
  value_inr_cr   NUMERIC(20,2),
  status         TEXT NOT NULL CHECK (status IN ('published','awarded','cancelled')),
  published_date DATE,
  award_date     DATE,
  url            TEXT,
  -- Name matching against 100+ ministries is imperfect and the UI says so.
  match_confidence TEXT CHECK (match_confidence IN ('high','medium','low')),
  source_record_id BIGINT NOT NULL REFERENCES source_record (source_record_id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tender_ministry_idx ON tender (ministry_id, published_date DESC);
CREATE INDEX tender_scheme_idx   ON tender (scheme_id, published_date DESC);
CREATE INDEX tender_published_idx ON tender (published_date DESC);
CREATE INDEX tender_title_trgm_idx ON tender USING gin (title gin_trgm_ops);

CREATE TABLE evidence_item (
  evidence_id    BIGSERIAL PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('pib','news','parliament_qa')),
  title          TEXT NOT NULL,
  url            TEXT,
  published_date DATE,
  ministry_id    TEXT REFERENCES ministry (ministry_id),
  scheme_id      TEXT REFERENCES scheme (scheme_id),
  -- Agent written, at most two sentences, strictly descriptive.
  summary        TEXT,
  -- 1024 dims matches the embedding model used by the retrieval step. Nullable
  -- so ingestion never blocks on the embedding service being reachable.
  embedding      VECTOR(1024),
  source_record_id BIGINT NOT NULL REFERENCES source_record (source_record_id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, url)
);

CREATE INDEX evidence_ministry_idx ON evidence_item (ministry_id, published_date DESC);
CREATE INDEX evidence_scheme_idx   ON evidence_item (scheme_id, published_date DESC);
CREATE INDEX evidence_kind_date_idx ON evidence_item (kind, published_date DESC);
-- Cosine distance is what the retrieval query uses; the index has to match.
CREATE INDEX evidence_embedding_idx ON evidence_item
  USING hnsw (embedding vector_cosine_ops);

CREATE TABLE anomaly_flag (
  flag_id     BIGSERIAL PRIMARY KEY,
  rule_id     TEXT NOT NULL CHECK (rule_id IN
                ('march_rush','under_utilization','over_burn','spend_no_tender',
                 'revision_swing','stat_outlier')),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ministry','scheme','national')),
  entity_id   TEXT NOT NULL,
  fy          TEXT NOT NULL REFERENCES fiscal_year (fy),
  severity    TEXT NOT NULL CHECK (severity IN ('info','notable','high')),
  -- Rule-specific numbers. The rule decides the flag exists; the agent only
  -- writes the prose (docs/05 A3).
  metric      JSONB NOT NULL,
  explanation TEXT NOT NULL,
  -- Every notable and high flag requires human approval before it is public.
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Re-running the rules must update the existing flag rather than spamming
  -- the review queue with a fresh copy every night.
  UNIQUE (rule_id, entity_type, entity_id, fy)
);

CREATE INDEX anomaly_flag_public_idx ON anomaly_flag (fy, severity, created_at DESC)
  WHERE status = 'approved';
CREATE INDEX anomaly_flag_pending_idx ON anomaly_flag (created_at DESC)
  WHERE status = 'pending';
CREATE INDEX anomaly_flag_entity_idx ON anomaly_flag (entity_type, entity_id, fy);

-- Links a flag to the evidence the explanation cites.
CREATE TABLE anomaly_flag_evidence (
  flag_id     BIGINT NOT NULL REFERENCES anomaly_flag (flag_id) ON DELETE CASCADE,
  evidence_id BIGINT NOT NULL REFERENCES evidence_item (evidence_id) ON DELETE CASCADE,
  PRIMARY KEY (flag_id, evidence_id)
);

CREATE TABLE verification_report (
  report_id    BIGSERIAL PRIMARY KEY,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('ministry','scheme','national')),
  entity_id    TEXT NOT NULL,
  fy           TEXT NOT NULL REFERENCES fiscal_year (fy),
  narrative_md TEXT NOT NULL,
  citations    JSONB NOT NULL DEFAULT '[]'::JSONB,
  confidence   TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  -- The A4 self-check pass: a second call confirms every number in the
  -- narrative appears in the facts it was given. A report that fails twice
  -- falls back to a template rendering and is marked accordingly.
  self_check_passed BOOLEAN NOT NULL DEFAULT FALSE,
  is_fallback  BOOLEAN NOT NULL DEFAULT FALSE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Provenance metadata for the admin surface only. docs/06 rule 4 keeps
  -- version strings out of every public surface.
  model        TEXT,
  prompt_version TEXT,
  CONSTRAINT verification_citations_is_array CHECK (jsonb_typeof(citations) = 'array')
);

CREATE INDEX verification_report_entity_idx
  ON verification_report (entity_type, entity_id, fy, generated_at DESC);

-- Agent call log: model, tokens, latency and validation outcome for every call
-- (docs/09 plane B). Drives the weekly cost and quality review.
CREATE TABLE agent_call (
  call_id        BIGSERIAL PRIMARY KEY,
  agent_id       TEXT NOT NULL,        -- 'A1'..'A6'
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_tokens   INT,
  output_tokens  INT,
  latency_ms     INT,
  validation_passed BOOLEAN,
  entity_type    TEXT,
  entity_id      TEXT,
  error_text     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX agent_call_agent_idx ON agent_call (agent_id, created_at DESC);

-- Publicly logged corrections (docs/08 section 2). Credibility is the moat, so
-- corrections are a first-class table, not an inbox.
CREATE TABLE correction (
  correction_id BIGSERIAL PRIMARY KEY,
  entity_type   TEXT,
  entity_id     TEXT,
  fy            TEXT,
  reported_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reporter_note TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','accepted','rejected','fixed')),
  resolution    TEXT,
  resolved_at   TIMESTAMPTZ
);
