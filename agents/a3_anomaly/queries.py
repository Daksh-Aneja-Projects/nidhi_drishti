"""Measurement SQL for A3.

Aggregation only. Not one threshold appears in this file: the queries produce
numbers, :mod:`agents.a3_anomaly.rules` decides what they mean. Keeping the
thresholds out of SQL is what makes them testable without a database and
auditable without reading a query plan.

All of these read the materialised views from db/migrations/0005, so they see the
same figures the dashboard shows. A flag computed from a different derivation
than the chart beside it would be indefensible the first time someone checked.
"""

from __future__ import annotations

MINISTRY_MEASURES_SQL = """
SELECT
  'ministry'::text                AS entity_type,
  s.ministry_id                   AS entity_id,
  s.name                          AS entity_label,
  s.fy,
  s.be,
  s.re,
  s.supplementary,
  s.current_authority,
  s.expenditure_to_date,
  s.expenditure_as_of,
  -- pct_fy_elapsed and pct_spent are published as percentages; the rules work
  -- in fractions, so the conversion happens once, here.
  s.pct_fy_elapsed / 100.0        AS pct_fy_elapsed,
  s.burn_ratio,
  s.capital_expenditure,
  NULL::numeric                   AS released,
  t.tender_count_trailing_90d
FROM mv_ministry_summary s
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS tender_count_trailing_90d
    FROM tender
   WHERE tender.ministry_id = s.ministry_id
     AND tender.published_date IS NOT NULL
     AND tender.published_date
         > COALESCE(s.expenditure_as_of, fy_end(s.fy)) - INTERVAL '90 days'
     AND tender.published_date <= COALESCE(s.expenditure_as_of, fy_end(s.fy))
) t ON TRUE
WHERE s.fy = %(fy)s
ORDER BY s.ministry_id
"""

SCHEME_MEASURES_SQL = """
SELECT
  'scheme'::text                  AS entity_type,
  s.scheme_id                     AS entity_id,
  s.name                          AS entity_label,
  s.fy,
  NULL::numeric                   AS be,
  NULL::numeric                   AS re,
  NULL::numeric                   AS supplementary,
  s.allocation                    AS current_authority,
  s.utilized                      AS expenditure_to_date,
  NULL::date                      AS expenditure_as_of,
  NULL::numeric                   AS pct_fy_elapsed,
  NULL::numeric                   AS burn_ratio,
  NULL::numeric                   AS capital_expenditure,
  s.released,
  s.tender_count                  AS tender_count_trailing_90d
FROM mv_scheme_summary s
WHERE s.fy = %(fy)s
ORDER BY s.scheme_id
"""

#: BE and RE for schemes come straight from the current-fact view, because the
#: scheme summary collapses them into a single "allocation" column and the
#: revision_swing rule needs both sides of the revision.
SCHEME_AUTHORITY_SQL = """
SELECT entity_id,
       MAX(amount_inr_cr) FILTER (WHERE stage = 'BE') AS be,
       MAX(amount_inr_cr) FILTER (WHERE stage = 'RE') AS re
  FROM v_fiscal_fact_current
 WHERE fy = %(fy)s AND entity_type = 'scheme' AND head = 'total'
 GROUP BY entity_id
"""

NATIONAL_MEASURES_SQL = """
SELECT
  'national'::text                AS entity_type,
  'national'::text                AS entity_id,
  'Union Government'::text        AS entity_label,
  n.fy,
  n.be,
  n.re,
  n.supplementary,
  n.current_authority,
  n.expenditure_to_date,
  n.expenditure_as_of,
  n.pct_fy_elapsed / 100.0        AS pct_fy_elapsed,
  n.burn_ratio,
  NULL::numeric                   AS capital_expenditure,
  NULL::numeric                   AS released,
  NULL::int                       AS tender_count_trailing_90d
FROM mv_national_summary n
WHERE n.fy = %(fy)s
"""

#: De-cumulated monthly spend for the year under test. Revision artefacts (a
#: negative month produced by a restated cumulative figure) are carried through
#: rather than clamped: clamping would inflate the annual total and hide the
#: revision, which docs/04 section 3 forbids.
MONTHLY_SPEND_SQL = """
SELECT entity_type, entity_id, fiscal_month_index, monthly_amount
  FROM mv_monthly_spend
 WHERE fy = %(fy)s
   AND monthly_amount IS NOT NULL
 ORDER BY entity_type, entity_id, fiscal_month_index
"""

#: Same-month history from earlier years, for the statistical rule. Excludes the
#: year under test so the current observation is never part of its own baseline.
MONTHLY_HISTORY_SQL = """
SELECT entity_type, entity_id, fiscal_month_index, fy, monthly_amount
  FROM mv_monthly_spend
 WHERE fy <> %(fy)s
   AND fy < %(fy)s
   AND monthly_amount IS NOT NULL
 ORDER BY entity_type, entity_id, fiscal_month_index, fy DESC
"""

#: Evidence offered to the explanation model. Date-bounded to the fiscal year so
#: a flag about FY2026 is never illustrated with a release from FY2022.
FLAG_EVIDENCE_SQL = """
SELECT evidence_id, kind, title, url, published_date, summary
  FROM evidence_item
 WHERE published_date BETWEEN fy_start(%(fy)s) AND fy_end(%(fy)s)
   AND (
     (%(entity_type)s = 'ministry' AND ministry_id = %(entity_id)s)
     OR (%(entity_type)s = 'scheme' AND scheme_id = %(entity_id)s)
   )
 ORDER BY published_date DESC
 LIMIT %(limit)s
"""
