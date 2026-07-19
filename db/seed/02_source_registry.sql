-- Source registry (docs/03).
--
-- Every source the product touches is declared here before a pipeline may write
-- for it, with its licence note and any access decision forced by robots.txt or
-- terms (docs/08 section 1). A source with no row here cannot be ingested: the
-- source_record foreign key sees to that.
--
-- expected_interval_hours drives staleness alerting at 2x the interval.

INSERT INTO source_registry
  (source_id, name, tier, cadence, method, format, homepage_url,
   license_note, access_note, expected_interval_hours)
VALUES
  ('union_budget', 'Union Budget documents, Ministry of Finance', 1, 'annual',
   'download', 'PDF/XLS', 'https://www.indiabudget.gov.in/',
   'Government of India published budget documents. Reuse permitted under the National Data Sharing and Accessibility Policy with attribution.',
   'Direct download of published documents, no authentication. Supplementary demands are fetched as they are laid before Parliament.',
   24 * 30),

  ('cga_monthly', 'Monthly Accounts, Controller General of Accounts', 1, 'monthly',
   'download', 'PDF/HTML', 'https://cga.nic.in/MonthlyReport.aspx',
   'Government of India published accounts. Reuse permitted under NDSAP with attribution.',
   'Published around the last day of the following month. Figures are provisional and are revised in later releases; revisions are recorded through supersedes_fact_id.',
   24 * 35),

  ('pfms_pub', 'PFMS published dashboards', 1, 'weekly',
   'playwright', 'HTML', 'https://pfms.nic.in/',
   'Government of India published dashboard figures. Attribution required. Figures are reproduced as published on the dashboard on the stated date.',
   'No open public API exists. Only the published public dashboard is read, with no authentication and no bypass of any access control. Dashboard figures are cumulative for the year and are never summed across snapshots.',
   24 * 7),

  ('ogd', 'data.gov.in Open Government Data Platform', 1, 'ad_hoc',
   'api', 'JSON/CSV', 'https://data.gov.in/',
   'Government Open Data License India (GODL). Attribution required.',
   'Real API with a free key. Preferred over scraping wherever a dataset mirrors a Tier 1 source. Per-dataset update cadence varies, so freshness is tracked per resource.',
   24 * 7),

  ('obi', 'Open Budgets India, CivicDataLab', 1, 'annual',
   'download', 'CSV', 'https://openbudgetsindia.org/',
   'Creative Commons licensed, verify the current licence per dataset. Attribute CivicDataLab.',
   'Used to bootstrap historical budget series and to cross-check our own parsing of the budget documents. Never the sole source for a current-year figure.',
   24 * 90),

  ('rbi', 'Reserve Bank of India statistics', 1, 'monthly',
   'download', 'HTML/XLS', 'https://www.rbi.org.in/Scripts/Statistics.aspx',
   'RBI published statistics, reuse with attribution.',
   'Macro context only, such as the fiscal deficit trajectory. Never a source for a ministry or scheme figure.',
   24 * 35),

  ('cppp', 'Central Public Procurement Portal', 2, 'daily',
   'scrape', 'HTML', 'https://eprocure.gov.in/eprocure/app',
   'Government of India published tender notices. Attribution required.',
   'Only public listing pages that the portal serves to any visitor are read, at no more than one request every two seconds. CAPTCHA protected flows are never touched, so coverage is partial by design.',
   36),

  ('gem', 'Government e-Marketplace statistics', 2, 'weekly',
   'scrape', 'HTML/JSON', 'https://gem.gov.in/',
   'Government of India published procurement statistics. Attribution required.',
   'Public aggregate statistics only. Item level data is not collected.',
   24 * 8),

  ('pib', 'Press Information Bureau releases', 2, 'daily',
   'rss', 'HTML', 'https://pib.gov.in/',
   'Government of India press releases, reuse with attribution.',
   'Read through the public release archive. Used as evidence of announced activity, never as a source for a fiscal figure.',
   36),

  ('sansad_qa', 'Parliament questions and answers', 2, 'per_session',
   'scrape', 'PDF', 'https://sansad.in/',
   'Parliamentary proceedings, public record. Attribution required.',
   'Written answers frequently contain scheme utilisation tables published nowhere else, and carry their own citability. Available only when a House is in session.',
   24 * 30),

  ('news', 'Curated media reporting', 2, 'daily',
   'rss', 'HTML', 'https://example.org/',
   'Headlines and links only, under fair dealing. Full article text is never stored or republished.',
   'Tertiary evidence, always labelled as media reporting and always linked. Never a source for a number shown on a chart.',
   36),

  ('demo', 'Illustrative sample dataset', 3, 'ad_hoc',
   'generated', 'SQL', 'https://example.org/',
   'Not government data. Generated locally for interface review.',
   'Every figure loaded from this source is written with extraction_method = illustrative, is excluded from any deployment running DATA_MODE=live, and forces a persistent banner in the interface. It exists so the dashboard can be reviewed before live ingestion, and must never be cited.',
   24 * 365)

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
