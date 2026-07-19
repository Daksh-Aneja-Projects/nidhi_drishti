-- ============================================================================
-- ILLUSTRATIVE DEMO DATASET. NOT GOVERNMENT DATA.
--
-- Every figure below is synthetically generated with deterministic arithmetic
-- so the dashboard, charts and review queue can be exercised before any real
-- pipeline has run. None of it comes from the Union Budget, CGA, PFMS or any
-- other Tier 1/2 source in docs/03. It must never be cited, screenshotted as
-- evidence, or treated as a real finding about any ministry or scheme.
--
-- Every fiscal_fact row this file writes carries extraction_method =
-- 'illustrative', which is what powers the persistent "illustrative data"
-- banner and the check_invariants() 'illustrative_data_present' warning
-- (db/migrations/0006_search_and_invariants.sql). A deployment running
-- DATA_MODE=live must never load this file.
--
-- This file is only ever loaded by `pnpm db:seed:demo`, never by the plain
-- `pnpm db:seed` used against a production database.
--
-- The file is idempotent: it deletes everything previously written under
-- source_id = 'demo', in FK-safe order, and then regenerates it, so it can be
-- re-run freely while iterating on the interface.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Clean slate. Children before parents.
-- ---------------------------------------------------------------------------

-- anomaly_flag has no source_record_id of its own (docs/04: it is a rule
-- output, not a fetched artifact), so the demo rows are identified by the
-- fixed (rule_id, entity_type, entity_id, fy) tuples this file inserts below.
DELETE FROM anomaly_flag_evidence
WHERE flag_id IN (
  SELECT flag_id FROM anomaly_flag WHERE (rule_id, entity_type, entity_id, fy) IN (VALUES
    ('march_rush',         'ministry', 'min-rural-development', 'FY2025'),
    ('under_utilization',  'scheme',   'sch-pmay-urban',         'FY2024'),
    ('over_burn',          'ministry', 'min-defence',            'FY2026'),
    ('spend_no_tender',    'scheme',   'sch-jal-jeevan-mission',  'FY2025'),
    ('stat_outlier',       'national', 'india',                  'FY2026'),
    ('revision_swing',     'ministry', 'min-power',               'FY2024')
  )
)
OR evidence_id IN (
  SELECT evidence_id FROM evidence_item
  WHERE source_record_id IN (SELECT source_record_id FROM source_record WHERE source_id = 'demo')
);

DELETE FROM anomaly_flag WHERE (rule_id, entity_type, entity_id, fy) IN (VALUES
  ('march_rush',         'ministry', 'min-rural-development', 'FY2025'),
  ('under_utilization',  'scheme',   'sch-pmay-urban',         'FY2024'),
  ('over_burn',          'ministry', 'min-defence',            'FY2026'),
  ('spend_no_tender',    'scheme',   'sch-jal-jeevan-mission',  'FY2025'),
  ('stat_outlier',       'national', 'india',                  'FY2026'),
  ('revision_swing',     'ministry', 'min-power',               'FY2024')
);

DELETE FROM evidence_item
WHERE source_record_id IN (SELECT source_record_id FROM source_record WHERE source_id = 'demo');

DELETE FROM tender
WHERE source_record_id IN (SELECT source_record_id FROM source_record WHERE source_id = 'demo');

DELETE FROM fiscal_fact
WHERE source_record_id IN (SELECT source_record_id FROM source_record WHERE source_id = 'demo');

DELETE FROM source_record WHERE source_id = 'demo';
DELETE FROM pipeline_run  WHERE source_id = 'demo';

-- ---------------------------------------------------------------------------
-- Exactly one pipeline_run and one source_record for the whole file. Every
-- fiscal_fact, tender and evidence_item below points at this single record.
-- The checksum is deterministic (two md5 digests concatenated to the 64 hex
-- characters source_record_artifact_sha256_check requires), not a real
-- artifact hash, since nothing was actually fetched.
-- ---------------------------------------------------------------------------
WITH pr AS (
  INSERT INTO pipeline_run (source_id, started_at, finished_at, status, metrics)
  VALUES (
    'demo', now(), now(), 'ok',
    jsonb_build_object(
      'note', 'Illustrative demo dataset, not government data. Loaded only by pnpm db:seed:demo.',
      'generator', 'db/seed/90_demo_dataset.sql'
    )
  )
  RETURNING run_id
)
INSERT INTO source_record
  (source_id, url, artifact_key, artifact_sha256, document_date, fetched_at, content_type, byte_size, pipeline_run_id)
SELECT
  'demo',
  NULL,
  'demo/illustrative-dataset.sql',
  md5('nidhi-drishti-demo-dataset-v1') || md5('illustrative-not-government-data'),
  CURRENT_DATE,
  now(),
  'application/sql',
  NULL,
  run_id
FROM pr;

-- ---------------------------------------------------------------------------
-- Ministry BE and RE, all three fiscal years.
--
-- be_cr grows 8% a year off a per-ministry base derived from ministry_id
-- ordering (rnk), so every ministry gets a distinct, stable size. re_factor
-- spreads RE both above and below BE across ministries (0.90x .. 1.10x) so
-- the dashboard shows genuine upward and downward revisions, not a uniform
-- pattern.
-- ---------------------------------------------------------------------------
WITH ministry_base AS (
  SELECT ministry_id, ROW_NUMBER() OVER (ORDER BY ministry_id) AS rnk
  FROM ministry WHERE active
),
fy_list AS (
  SELECT * FROM (VALUES ('FY2024', 0), ('FY2025', 1), ('FY2026', 2)) AS t(fy, fy_offset)
),
ministry_fy AS (
  SELECT
    mb.ministry_id,
    fl.fy,
    ROUND((3000 + ((mb.rnk * 5237) % 250000))::numeric * POWER(1.08, fl.fy_offset), 2) AS be_cr,
    (0.90 + (mb.rnk % 5) * 0.05)::numeric AS re_factor
  FROM ministry_base mb CROSS JOIN fy_list fl
)
INSERT INTO fiscal_fact
  (fy, entity_type, entity_id, stage, head, period_start, period_end, is_cumulative,
   amount_inr_cr, source_record_id, extraction_method, is_provisional)
SELECT
  fy, 'ministry', ministry_id, 'BE', 'total', NULL, NULL, FALSE, be_cr,
  (SELECT source_record_id FROM source_record WHERE source_id = 'demo'
     AND artifact_key = 'demo/illustrative-dataset.sql'),
  'illustrative', FALSE
FROM ministry_fy
UNION ALL
SELECT
  fy, 'ministry', ministry_id, 'RE', 'total', NULL, NULL, FALSE, ROUND(be_cr * re_factor, 2),
  (SELECT source_record_id FROM source_record WHERE source_id = 'demo'
     AND artifact_key = 'demo/illustrative-dataset.sql'),
  'illustrative', FALSE
FROM ministry_fy;

-- ---------------------------------------------------------------------------
-- Ministry monthly cumulative EXPENDITURE, head total/revenue/capital.
--
-- pace_factor (0.70x .. 1.24x across seven buckets) is the deliberate burn
-- spread the brief asks for: below 1.0 is a ministry running behind the
-- straight-line pace implied by the elapsed fiscal year, above 1.0 is running
-- ahead. FY2024 and FY2025 report all twelve fiscal months (April to March);
-- FY2026 stops at fiscal month 8 (November) because it is the in-progress
-- year, which is also why only its expenditure rows are marked provisional.
-- ---------------------------------------------------------------------------
WITH ministry_base AS (
  SELECT ministry_id, ROW_NUMBER() OVER (ORDER BY ministry_id) AS rnk
  FROM ministry WHERE active
),
fy_months AS (
  SELECT * FROM (VALUES ('FY2024', 0, 12), ('FY2025', 1, 12), ('FY2026', 2, 8)) AS t(fy, fy_offset, max_month)
),
ministry_series AS (
  SELECT
    mb.ministry_id,
    fm.fy,
    gs.month,
    ROUND((3000 + ((mb.rnk * 5237) % 250000))::numeric * POWER(1.08, fm.fy_offset), 2) AS be_cr,
    (0.90 + (mb.rnk % 5) * 0.05)::numeric AS re_factor,
    (0.70 + (mb.rnk % 7) * 0.09)::numeric AS pace_factor,
    (0.55 + (mb.rnk % 4) * 0.06)::numeric AS revenue_frac,
    fy_start(fm.fy) AS period_start,
    (date_trunc('month', fy_start(fm.fy)::timestamp + ((gs.month - 1) || ' months')::interval)
       + interval '1 month' - interval '1 day')::date AS period_end
  FROM ministry_base mb
  CROSS JOIN fy_months fm
  CROSS JOIN LATERAL generate_series(1, fm.max_month) AS gs(month)
),
ministry_amounts AS (
  SELECT
    *,
    ROUND((be_cr * re_factor) * pace_factor * (month::numeric / 12), 2) AS total_cumulative
  FROM ministry_series
)
INSERT INTO fiscal_fact
  (fy, entity_type, entity_id, stage, head, period_start, period_end, is_cumulative,
   amount_inr_cr, source_record_id, extraction_method, is_provisional)
SELECT
  fy, 'ministry', ministry_id, 'EXPENDITURE', 'total', period_start, period_end, TRUE, total_cumulative,
  (SELECT source_record_id FROM source_record WHERE source_id = 'demo'
     AND artifact_key = 'demo/illustrative-dataset.sql'),
  'illustrative', (fy = 'FY2026')
FROM ministry_amounts
UNION ALL
SELECT
  fy, 'ministry', ministry_id, 'EXPENDITURE', 'revenue', period_start, period_end, TRUE,
  ROUND(total_cumulative * revenue_frac, 2),
  (SELECT source_record_id FROM source_record WHERE source_id = 'demo'
     AND artifact_key = 'demo/illustrative-dataset.sql'),
  'illustrative', (fy = 'FY2026')
FROM ministry_amounts
UNION ALL
SELECT
  fy, 'ministry', ministry_id, 'EXPENDITURE', 'capital', period_start, period_end, TRUE,
  ROUND(total_cumulative * (1 - revenue_frac), 2),
  (SELECT source_record_id FROM source_record WHERE source_id = 'demo'
     AND artifact_key = 'demo/illustrative-dataset.sql'),
  'illustrative', (fy = 'FY2026')
FROM ministry_amounts;

-- ---------------------------------------------------------------------------
-- National BE and RE.
--
-- national_be is deliberately not equal to the sum of ministry BE: it is 22%
-- higher, standing in for interest payments, Finance Commission transfers to
-- states and other spend that sits outside any single ministry demand. The
-- mv_national_summary.ministry_sum_residual column and the
-- ministry_sum_vs_national_be invariant both expect and surface exactly this
-- kind of gap (docs/04 invariant 1).
-- ---------------------------------------------------------------------------
WITH ministry_base AS (
  SELECT ministry_id, ROW_NUMBER() OVER (ORDER BY ministry_id) AS rnk
  FROM ministry WHERE active
),
fy_list AS (
  SELECT * FROM (VALUES ('FY2024', 0), ('FY2025', 1), ('FY2026', 2)) AS t(fy, fy_offset)
),
ministry_be_sum AS (
  SELECT
    fl.fy,
    SUM(ROUND((3000 + ((mb.rnk * 5237) % 250000))::numeric * POWER(1.08, fl.fy_offset), 2)) AS ministry_be_total
  FROM ministry_base mb CROSS JOIN fy_list fl
  GROUP BY fl.fy
),
national_fy AS (
  SELECT
    fy,
    ROUND(ministry_be_total * 1.22, 2) AS national_be,
    ROUND(ministry_be_total * 1.22 * (1.01 + (CASE fy WHEN 'FY2024' THEN 0 WHEN 'FY2025' THEN 1 ELSE 2 END) * 0.01), 2)
      AS national_re
  FROM ministry_be_sum
)
INSERT INTO fiscal_fact
  (fy, entity_type, entity_id, stage, head, period_start, period_end, is_cumulative,
   amount_inr_cr, source_record_id, extraction_method, is_provisional)
SELECT
  fy, 'national', 'india', 'BE', 'total', NULL, NULL, FALSE, national_be,
  (SELECT source_record_id FROM source_record WHERE source_id = 'demo'
     AND artifact_key = 'demo/illustrative-dataset.sql'),
  'illustrative', FALSE
FROM national_fy
UNION ALL
SELECT
  fy, 'national', 'india', 'RE', 'total', NULL, NULL, FALSE, national_re,
  (SELECT source_record_id FROM source_record WHERE source_id = 'demo'
     AND artifact_key = 'demo/illustrative-dataset.sql'),
  'illustrative', FALSE
FROM national_fy;

-- ---------------------------------------------------------------------------
-- National monthly cumulative EXPENDITURE, head total only.
--
-- A flat 0.92x pace against national RE, so the national headline sits
-- slightly behind straight-line pace, distinct from any single ministry's
-- pace_factor above.
-- ---------------------------------------------------------------------------
WITH ministry_base AS (
  SELECT ministry_id, ROW_NUMBER() OVER (ORDER BY ministry_id) AS rnk
  FROM ministry WHERE active
),
fy_offsets AS (
  SELECT * FROM (VALUES ('FY2024', 0), ('FY2025', 1), ('FY2026', 2)) AS t(fy, fy_offset)
),
fy_months AS (
  SELECT * FROM (VALUES ('FY2024', 12), ('FY2025', 12), ('FY2026', 8)) AS t(fy, max_month)
),
ministry_be_sum AS (
  SELECT
    fo.fy,
    SUM(ROUND((3000 + ((mb.rnk * 5237) % 250000))::numeric * POWER(1.08, fo.fy_offset), 2)) AS ministry_be_total
  FROM ministry_base mb CROSS JOIN fy_offsets fo
  GROUP BY fo.fy
),
national_re AS (
  SELECT
    fy,
    ROUND(ministry_be_total * 1.22 * (1.01 + (CASE fy WHEN 'FY2024' THEN 0 WHEN 'FY2025' THEN 1 ELSE 2 END) * 0.01), 2)
      AS national_re
  FROM ministry_be_sum
),
national_series AS (
  SELECT
    nr.fy,
    gs.month,
    nr.national_re,
    fy_start(nr.fy) AS period_start,
    (date_trunc('month', fy_start(nr.fy)::timestamp + ((gs.month - 1) || ' months')::interval)
       + interval '1 month' - interval '1 day')::date AS period_end
  FROM national_re nr
  JOIN fy_months fm ON fm.fy = nr.fy
  CROSS JOIN LATERAL generate_series(1, fm.max_month) AS gs(month)
)
INSERT INTO fiscal_fact
  (fy, entity_type, entity_id, stage, head, period_start, period_end, is_cumulative,
   amount_inr_cr, source_record_id, extraction_method, is_provisional)
SELECT
  fy, 'national', 'india', 'EXPENDITURE', 'total', period_start, period_end, TRUE,
  ROUND(national_re * 0.92 * (month::numeric / 12), 2),
  (SELECT source_record_id FROM source_record WHERE source_id = 'demo'
     AND artifact_key = 'demo/illustrative-dataset.sql'),
  'illustrative', (fy = 'FY2026')
FROM national_series;

-- ---------------------------------------------------------------------------
-- Scheme BE, RELEASE (cumulative snapshot) and, for exactly the even-ranked
-- half of schemes, UTILIZATION. The odd-ranked half gets no utilization row
-- at all, on purpose: mv_scheme_summary.utilized stays NULL for them and the
-- UI's "Not reported" path is what a reviewer should see, never a zero.
--
-- Release and utilization are each a single as-of snapshot per fiscal year
-- (dated at the year's latest reported month), matching how PFMS actually
-- publishes scheme releases: a cumulative dashboard figure, not a stored
-- monthly series (docs/03 section 1.3).
-- ---------------------------------------------------------------------------
WITH scheme_base AS (
  SELECT scheme_id, ROW_NUMBER() OVER (ORDER BY scheme_id) AS srnk
  FROM scheme WHERE active
),
fy_list AS (
  SELECT * FROM (VALUES ('FY2024', 0, 12), ('FY2025', 1, 12), ('FY2026', 2, 8)) AS t(fy, fy_offset, max_month)
),
scheme_fy AS (
  SELECT
    sb.scheme_id,
    fl.fy,
    ROUND((150 + ((sb.srnk * 977) % 42000))::numeric * POWER(1.07, fl.fy_offset), 2) AS be_cr,
    (0.45 + (sb.srnk % 6) * 0.09)::numeric AS release_pace,
    (0.40 + (sb.srnk % 5) * 0.10)::numeric AS utilization_frac,
    (sb.srnk % 2 = 0) AS has_utilization,
    fy_start(fl.fy) AS period_start,
    (date_trunc('month', fy_start(fl.fy)::timestamp + ((fl.max_month - 1) || ' months')::interval)
       + interval '1 month' - interval '1 day')::date AS period_end
  FROM scheme_base sb CROSS JOIN fy_list fl
),
scheme_release AS (
  SELECT *, ROUND(be_cr * release_pace, 2) AS released_cumulative
  FROM scheme_fy
)
INSERT INTO fiscal_fact
  (fy, entity_type, entity_id, stage, head, period_start, period_end, is_cumulative,
   amount_inr_cr, source_record_id, extraction_method, is_provisional)
SELECT
  fy, 'scheme', scheme_id, 'BE', 'total', NULL, NULL, FALSE, be_cr,
  (SELECT source_record_id FROM source_record WHERE source_id = 'demo'
     AND artifact_key = 'demo/illustrative-dataset.sql'),
  'illustrative', FALSE
FROM scheme_release
UNION ALL
SELECT
  fy, 'scheme', scheme_id, 'RELEASE', 'total', period_start, period_end, TRUE, released_cumulative,
  (SELECT source_record_id FROM source_record WHERE source_id = 'demo'
     AND artifact_key = 'demo/illustrative-dataset.sql'),
  'illustrative', (fy = 'FY2026')
FROM scheme_release
UNION ALL
SELECT
  fy, 'scheme', scheme_id, 'UTILIZATION', 'total', period_start, period_end, TRUE,
  ROUND(released_cumulative * utilization_frac, 2),
  (SELECT source_record_id FROM source_record WHERE source_id = 'demo'
     AND artifact_key = 'demo/illustrative-dataset.sql'),
  'illustrative', (fy = 'FY2026')
FROM scheme_release
WHERE has_utilization;

-- ---------------------------------------------------------------------------
-- Tenders. A handful, spanning all three fiscal years and a mix of statuses,
-- so the scheme page's tender rollup has something to show.
-- ---------------------------------------------------------------------------
INSERT INTO tender
  (tender_id, title, org_raw, ministry_id, scheme_id, value_inr_cr, status,
   published_date, award_date, url, match_confidence, source_record_id)
VALUES
  ('demo-tender-001', 'Rural road construction package, phase IV', 'Ministry of Rural Development',
    'min-rural-development', 'sch-pmgsy', 245.50, 'awarded', '2025-05-12', '2025-07-01',
    'https://example.org/demo/tender/001', 'high',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('demo-tender-002', 'Jal Jeevan Mission household tap connections, district package', 'Dept of Drinking Water and Sanitation',
    'min-jal-shakti-drinking-water-sanitation', 'sch-jal-jeevan-mission', 189.20, 'published', '2025-09-03', NULL,
    'https://example.org/demo/tender/002', 'high',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('demo-tender-003', 'Supply of rooftop solar panels under PM Surya Ghar', 'Ministry of Power',
    'min-power', 'sch-pm-surya-ghar', 412.75, 'awarded', '2025-02-18', '2025-04-02',
    'https://example.org/demo/tender/003', 'medium',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('demo-tender-004', 'National highway widening, corridor package 7', 'National Highways Authority of India',
    'min-road-transport-highways', 'sch-bharatmala-pariyojana', 980.00, 'published', '2026-05-20', NULL,
    'https://example.org/demo/tender/004', 'high',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('demo-tender-005', 'PM SHRI school infrastructure upgrade, cluster tender', 'Department of School Education and Literacy',
    'min-education-school', 'sch-pm-shri', 56.40, 'awarded', '2024-11-14', '2025-01-05',
    'https://example.org/demo/tender/005', 'medium',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('demo-tender-006', 'District hospital equipment procurement, PM-ABHIM', 'Ministry of Health and Family Welfare',
    'min-health-family-welfare', 'sch-pm-abhim', 132.60, 'cancelled', '2025-06-25', NULL,
    'https://example.org/demo/tender/006', 'medium',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('demo-tender-007', 'Fibre backbone rollout, gram panchayat connectivity', 'Department of Telecommunications',
    'min-communications-telecom', 'sch-bharatnet', 301.10, 'published', '2025-12-08', NULL,
    'https://example.org/demo/tender/007', 'high',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('demo-tender-008', 'Smart city command and control centre, tier 2 city', 'Ministry of Housing and Urban Affairs',
    'min-housing-urban-affairs', 'sch-smart-cities-mission', 78.90, 'awarded', '2024-08-22', '2024-10-15',
    'https://example.org/demo/tender/008', 'high',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('demo-tender-009', 'MSME cluster common facility centre construction', 'Ministry of Micro, Small and Medium Enterprises',
    'min-msme', 'sch-pmegp', 21.35, 'published', '2026-03-01', NULL,
    'https://example.org/demo/tender/009', 'low',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('demo-tender-010', 'Skill training centre equipment, PMKVY 4.0', 'Ministry of Skill Development and Entrepreneurship',
    'min-skill-development-entrepreneurship', 'sch-pmkvy', 44.80, 'awarded', '2025-03-30', '2025-05-18',
    'https://example.org/demo/tender/010', 'medium',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql'))
ON CONFLICT (tender_id) DO UPDATE SET
  title             = EXCLUDED.title,
  org_raw           = EXCLUDED.org_raw,
  ministry_id       = EXCLUDED.ministry_id,
  scheme_id         = EXCLUDED.scheme_id,
  value_inr_cr      = EXCLUDED.value_inr_cr,
  status            = EXCLUDED.status,
  published_date    = EXCLUDED.published_date,
  award_date        = EXCLUDED.award_date,
  url               = EXCLUDED.url,
  match_confidence  = EXCLUDED.match_confidence,
  source_record_id  = EXCLUDED.source_record_id;

-- ---------------------------------------------------------------------------
-- Evidence items. A small spread across the three kinds so the retrieval
-- and provenance UI both have something to render.
-- ---------------------------------------------------------------------------
INSERT INTO evidence_item
  (kind, title, url, published_date, ministry_id, scheme_id, summary, source_record_id)
VALUES
  ('pib', 'Illustrative PIB release: milestone reported under a flagship scheme',
    'https://example.org/demo/pib/001', '2025-06-10', 'min-jal-shakti-drinking-water-sanitation', 'sch-jal-jeevan-mission',
    'Illustrative summary, not a real press release. Demonstrates the evidence feed only.',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('news', 'Illustrative news clip: coverage of an urban housing scheme''s progress',
    'https://example.org/demo/news/001', '2025-07-22', 'min-housing-urban-affairs', 'sch-pmay-urban',
    'Illustrative summary. Media reporting is never a source for a fiscal figure.',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('parliament_qa', 'Illustrative written answer: scheme utilisation update',
    'https://example.org/demo/sansad/001', '2025-08-01', 'min-rural-development', 'sch-mgnrega',
    'Illustrative summary of a written-answer format, not a real parliamentary record.',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('pib', 'Illustrative PIB release: health infrastructure sanction announced',
    'https://example.org/demo/pib/002', '2025-09-15', 'min-health-family-welfare', 'sch-pm-abhim',
    'Illustrative summary only.',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('news', 'Illustrative news clip: highway package tender reported as awarded',
    'https://example.org/demo/news/002', '2026-06-02', 'min-road-transport-highways', 'sch-bharatmala-pariyojana',
    'Illustrative summary only.',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('pib', 'Illustrative PIB release: rooftop solar targets announced',
    'https://example.org/demo/pib/003', '2025-04-28', 'min-power', 'sch-pm-surya-ghar',
    'Illustrative summary only.',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('parliament_qa', 'Illustrative written answer: connectivity rollout status',
    'https://example.org/demo/sansad/002', '2025-12-20', 'min-communications-telecom', 'sch-bharatnet',
    'Illustrative summary only.',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql')),
  ('news', 'Illustrative news clip: skill centres reported equipped ahead of schedule',
    'https://example.org/demo/news/003', '2025-05-30', 'min-skill-development-entrepreneurship', 'sch-pmkvy',
    'Illustrative summary only.',
    (SELECT source_record_id FROM source_record WHERE source_id = 'demo' AND artifact_key = 'demo/illustrative-dataset.sql'))
ON CONFLICT (kind, url) DO UPDATE SET
  title          = EXCLUDED.title,
  published_date = EXCLUDED.published_date,
  ministry_id    = EXCLUDED.ministry_id,
  scheme_id      = EXCLUDED.scheme_id,
  summary        = EXCLUDED.summary,
  source_record_id = EXCLUDED.source_record_id;

-- ---------------------------------------------------------------------------
-- Anomaly flags. Mixed pending/approved so both the public flag feed
-- (approved only) and the admin review queue (pending only) have content.
-- Every explanation is explicitly labelled illustrative.
-- ---------------------------------------------------------------------------
INSERT INTO anomaly_flag
  (rule_id, entity_type, entity_id, fy, severity, metric, explanation, status, reviewed_by, reviewed_at, review_note)
VALUES
  ('march_rush', 'ministry', 'min-rural-development', 'FY2025', 'notable',
    jsonb_build_object('illustrative', true, 'q4_share_pct', 42.5, 'typical_share_pct', 28.0),
    'Illustrative example (demo dataset). In this sample, a disproportionate share of the fiscal year''s reported spend lands in the final quarter compared to the typical pattern. Not a real finding.',
    'approved', 'demo-reviewer', now(), 'Approved for the illustrative flag feed.'),
  ('under_utilization', 'scheme', 'sch-pmay-urban', 'FY2024', 'high',
    jsonb_build_object('illustrative', true, 'released_cr', 1200.0, 'utilized_cr', 410.0, 'utilization_pct', 34.2),
    'Illustrative example (demo dataset). Reported utilisation trails released funds by a wide margin in this sample. Not a real finding.',
    'pending', NULL, NULL, NULL),
  ('over_burn', 'ministry', 'min-defence', 'FY2026', 'info',
    jsonb_build_object('illustrative', true, 'burn_ratio', 1.18),
    'Illustrative example (demo dataset). Cumulative spend is running ahead of the pace implied by the elapsed fiscal year in this sample. Not a real finding.',
    'approved', 'demo-reviewer', now(), 'Approved for the illustrative flag feed.'),
  ('spend_no_tender', 'scheme', 'sch-jal-jeevan-mission', 'FY2025', 'notable',
    jsonb_build_object('illustrative', true, 'released_cr', 950.0, 'tender_count', 1),
    'Illustrative example (demo dataset). Reported release activity is high relative to the number of matched public tenders in this sample. Not a real finding.',
    'pending', NULL, NULL, NULL),
  ('stat_outlier', 'national', 'india', 'FY2026', 'info',
    jsonb_build_object('illustrative', true, 'z_score', 2.3),
    'Illustrative example (demo dataset). A month-over-month change in the national cumulative series falls outside the typical range in this sample. Not a real finding.',
    'approved', 'demo-reviewer', now(), 'Approved for the illustrative flag feed.'),
  ('revision_swing', 'ministry', 'min-power', 'FY2024', 'notable',
    jsonb_build_object('illustrative', true, 'revision_cr', -85.0),
    'Illustrative example (demo dataset). A later snapshot of the cumulative series revised an earlier reported month downward in this sample. Not a real finding.',
    'pending', NULL, NULL, NULL)
ON CONFLICT (rule_id, entity_type, entity_id, fy) DO UPDATE SET
  severity    = EXCLUDED.severity,
  metric      = EXCLUDED.metric,
  explanation = EXCLUDED.explanation,
  status      = EXCLUDED.status,
  reviewed_by = EXCLUDED.reviewed_by,
  reviewed_at = EXCLUDED.reviewed_at,
  review_note = EXCLUDED.review_note;

-- Link two of the flags to the evidence items that thematically back them.
INSERT INTO anomaly_flag_evidence (flag_id, evidence_id)
SELECT af.flag_id, ei.evidence_id
FROM anomaly_flag af, evidence_item ei
WHERE af.rule_id = 'under_utilization' AND af.entity_type = 'scheme' AND af.entity_id = 'sch-pmay-urban' AND af.fy = 'FY2024'
  AND ei.kind = 'news' AND ei.url = 'https://example.org/demo/news/001'
UNION ALL
SELECT af.flag_id, ei.evidence_id
FROM anomaly_flag af, evidence_item ei
WHERE af.rule_id = 'spend_no_tender' AND af.entity_type = 'scheme' AND af.entity_id = 'sch-jal-jeevan-mission' AND af.fy = 'FY2025'
  AND ei.kind = 'pib' AND ei.url = 'https://example.org/demo/pib/001'
ON CONFLICT DO NOTHING;
