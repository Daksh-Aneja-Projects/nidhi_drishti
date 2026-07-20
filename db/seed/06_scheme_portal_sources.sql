-- Scheme-specific portal sources (docs/03 section 2.6, roadmap v1.1).
--
-- Each flagship scheme runs its own public dashboard, so each is its own source
-- with its own licence note and access decision, declared here before any
-- pipeline may write for it. source_record.source_id is a foreign key to
-- source_registry, so a source with no row here cannot be ingested at all.
--
-- These portals are scheme-scoped: the whole site is one scheme, so the
-- pipeline maps every figure to a single fixed scheme_id from 04_schemes.sql
-- rather than resolving names through entity_alias.
--
-- expected_interval_hours drives staleness alerting at 2x the interval.

INSERT INTO source_registry
  (source_id, name, tier, cadence, method, format, homepage_url,
   license_note, access_note, expected_interval_hours)
VALUES
  ('mgnrega', 'MGNREGA public reports, Ministry of Rural Development', 1, 'weekly',
   'scrape', 'HTML', 'https://nrega.nic.in/',
   'Government of India published MIS reports. Reuse permitted under the National Data Sharing and Accessibility Policy with attribution.',
   'Only the public national and state financial progress reports are read, with no authentication and no bypass of any access control, at no more than one request every two seconds. Figures are cumulative for the financial year and are never summed across snapshots. Central Release maps to the RELEASE stage and Total Expenditure by implementing agencies maps to UTILIZATION; the two are kept strictly apart.',
   24 * 7),

  ('pmkisan', 'PM-KISAN dashboard, Ministry of Agriculture and Farmers Welfare', 1, 'monthly',
   'scrape', 'HTML', 'https://pmkisan.gov.in/',
   'Government of India published dashboard figures. Attribution required. Figures are reproduced as published on the dashboard on the stated date.',
   'Aggregate national figures only. Beneficiary-level DBT data is never ingested even where it is technically visible on the portal (docs/08 section 4); this is enforced in code, not left to discipline. Funds transferred is a direct benefit transfer disbursement and maps to the RELEASE stage; the underlying per-beneficiary transfers are never recorded. Figures are cumulative for the financial year and are never summed across snapshots.',
   24 * 30),

  ('jjm', 'Jal Jeevan Mission dashboard, Ministry of Jal Shakti', 1, 'weekly',
   'scrape', 'HTML', 'https://jaljeevanmission.gov.in/',
   'Government of India published dashboard figures. Attribution required. Figures are reproduced as published on the dashboard on the stated date.',
   'Only the public coverage and funding dashboard is read, with no authentication and no bypass of any access control. Central Release maps to the RELEASE stage and Total Expenditure maps to UTILIZATION; the two are kept strictly apart. Household tap connection coverage is a physical count and is never written to a money column. Figures are cumulative for the financial year and are never summed across snapshots.',
   24 * 7)

ON CONFLICT (source_id) DO UPDATE SET
  name         = EXCLUDED.name,
  tier         = EXCLUDED.tier,
  cadence      = EXCLUDED.cadence,
  method       = EXCLUDED.method,
  format       = EXCLUDED.format,
  homepage_url = EXCLUDED.homepage_url,
  license_note = EXCLUDED.license_note,
  access_note  = EXCLUDED.access_note,
  expected_interval_hours = EXCLUDED.expected_interval_hours;
