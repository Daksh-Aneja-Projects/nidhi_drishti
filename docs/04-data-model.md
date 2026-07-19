# 04 — Canonical Data Model

The heart of the product. Model the Indian fiscal pipeline correctly or every chart lies.

## 1. The five fiscal stages (never conflate)
```
BE (Budget Estimate, Feb 1)
  → RE (Revised Estimate, next Feb) [+ Supplementary Grants during the year]
    → Sanction (ministry approves spend)
      → Release / Disbursement (money leaves; PFMS-visible for schemes)
        → Utilization (implementing agency actually spends; UCs, partial visibility)
```
"Balance" is stage-relative. The dashboard's headline balance = (current authority: BE or RE+supplementary, whichever applies now) − (CGA actual expenditure to date). Scheme pages may additionally show released-vs-utilized where data exists.

## 2. Core tables (Postgres)

```sql
-- ============ REFERENCE ============
CREATE TABLE fiscal_year (
  fy TEXT PRIMARY KEY,          -- 'FY2026'
  start_date DATE NOT NULL,     -- 2025-04-01
  end_date DATE NOT NULL
);

CREATE TABLE ministry (
  ministry_id TEXT PRIMARY KEY,     -- stable slug: 'min-agriculture'
  name TEXT NOT NULL,
  sector TEXT,                      -- our vertical grouping: Agriculture, Defence, Health...
  active BOOLEAN DEFAULT TRUE
);

CREATE TABLE scheme (
  scheme_id TEXT PRIMARY KEY,       -- 'sch-pm-kisan'
  ministry_id TEXT REFERENCES ministry,
  name TEXT NOT NULL,
  scheme_type TEXT,                 -- 'CSS' | 'CS' | 'other'
  active BOOLEAN DEFAULT TRUE
);

-- Entity resolution: every raw name string ever seen maps to a stable id
CREATE TABLE entity_alias (
  alias TEXT NOT NULL,
  entity_type TEXT NOT NULL,        -- 'ministry' | 'scheme' | 'demand'
  entity_id TEXT NOT NULL,
  source_id TEXT,
  confidence NUMERIC(3,2) DEFAULT 1.0,
  PRIMARY KEY (alias, entity_type)
);

-- ============ PROVENANCE ============
CREATE TABLE source_record (
  source_record_id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL,          -- FK to source_registry
  url TEXT,
  artifact_key TEXT NOT NULL,       -- S3 key of raw artifact
  artifact_sha256 TEXT NOT NULL,
  document_date DATE,               -- date the document claims
  fetched_at TIMESTAMPTZ NOT NULL,
  pipeline_run_id BIGINT
);

-- ============ FISCAL FACTS ============
-- One row per (entity, fy, stage, period, source). Append-only; revisions supersede.
CREATE TABLE fiscal_fact (
  fact_id BIGSERIAL PRIMARY KEY,
  fy TEXT REFERENCES fiscal_year,
  entity_type TEXT NOT NULL,        -- 'ministry' | 'scheme' | 'national'
  entity_id TEXT NOT NULL,
  stage TEXT NOT NULL,              -- 'BE'|'RE'|'SUPPLEMENTARY'|'SANCTION'|'RELEASE'|'EXPENDITURE'|'UTILIZATION'
  head TEXT,                        -- 'revenue'|'capital'|'total'
  period_start DATE,                -- NULL for annual figures (BE/RE)
  period_end DATE,
  is_cumulative BOOLEAN NOT NULL,   -- CGA "April–Nov" figures are cumulative: TRUE
  amount_inr_cr NUMERIC(20,2) NOT NULL,
  source_record_id BIGINT NOT NULL REFERENCES source_record,
  is_provisional BOOLEAN DEFAULT FALSE,
  supersedes_fact_id BIGINT REFERENCES fiscal_fact,  -- revision lineage
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (fy, entity_type, entity_id, stage, head, period_start, period_end, source_record_id)
);
CREATE INDEX ON fiscal_fact (entity_type, entity_id, fy, stage);

-- ============ VERIFICATION LAYER ============
CREATE TABLE tender (
  tender_id TEXT PRIMARY KEY,       -- CPPP ref no
  title TEXT, org_raw TEXT,
  ministry_id TEXT REFERENCES ministry,      -- via entity_alias, nullable
  scheme_id TEXT REFERENCES scheme,          -- best-effort match, nullable
  value_inr_cr NUMERIC(20,2),
  status TEXT,                      -- 'published'|'awarded'|'cancelled'
  published_date DATE, award_date DATE,
  source_record_id BIGINT REFERENCES source_record
);

CREATE TABLE evidence_item (        -- PIB releases, news, parliament answers
  evidence_id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,               -- 'pib'|'news'|'parliament_qa'
  title TEXT, url TEXT, published_date DATE,
  ministry_id TEXT, scheme_id TEXT,
  summary TEXT,                     -- agent-written, <=2 sentences
  embedding VECTOR(1024),           -- pgvector, for retrieval
  source_record_id BIGINT REFERENCES source_record
);

CREATE TABLE anomaly_flag (
  flag_id BIGSERIAL PRIMARY KEY,
  rule_id TEXT NOT NULL,            -- 'march_rush'|'under_utilization'|'spend_no_tender'|'stat_outlier'
  entity_type TEXT, entity_id TEXT, fy TEXT,
  severity TEXT,                    -- 'info'|'notable'|'high'
  metric JSONB NOT NULL,            -- rule-specific numbers
  explanation TEXT NOT NULL,        -- plain language, agent-written, cited
  status TEXT DEFAULT 'pending',    -- 'pending'|'approved'|'rejected' (human review)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE verification_report (
  report_id BIGSERIAL PRIMARY KEY,
  entity_type TEXT, entity_id TEXT, fy TEXT,
  narrative_md TEXT NOT NULL,       -- agent output with inline citation markers
  citations JSONB NOT NULL,         -- [{n, url, title, date, kind}]
  confidence TEXT NOT NULL,         -- 'high'|'medium'|'low'
  generated_at TIMESTAMPTZ DEFAULT now(),
  model TEXT, prompt_version TEXT
);

-- ============ OPS ============
CREATE TABLE pipeline_run (
  run_id BIGSERIAL PRIMARY KEY,
  source_id TEXT, started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ,
  status TEXT,                      -- 'ok'|'drift_alert'|'failed'
  metrics JSONB                     -- row counts, diffs, warnings
);
```

## 3. Derived views (materialized)
- `mv_ministry_summary(fy)`: BE, RE, supplementary, expenditure_to_date (latest cumulative CGA fact), balance, pct_spent, pct_fy_elapsed, burn_ratio = pct_spent / pct_fy_elapsed.
- `mv_monthly_spend(entity, fy)`: de-cumulated monthly expenditure. **De-cumulation rule**: monthly = cumulative(m) − cumulative(m−1); if negative (revisions), keep and flag, don't clamp.
- `mv_scheme_summary(fy)`: allocation, releases (PFMS-published), utilization (where available), tender totals.
- `mv_national_summary(fy)`.

## 4. Invariants (write tests)
1. Sum of ministry BE ≈ national BE (tolerance for "Others"/transfers; log the residual).
2. No `fiscal_fact` without `source_record_id`.
3. Cumulative facts must be monotonically non-decreasing within FY per entity — violations flagged as revisions, alert raised.
4. `balance = authority − expenditure` computed in views only, never stored.
5. A superseded fact never appears in views.

## 5. Amount parsing rules (`parsers/inr_amounts.py`)
- Handle: "₹1,23,456.78 crore", "Rs. 1234 cr", "12,345 lakh" (÷100 → crore), "1.2 lakh crore" (×100000), plain numbers with column-header units.
- Reject ambiguous values (no unit context) → parse-error queue, never guess.
- Property tests with real strings harvested from Budget/CGA PDFs.
