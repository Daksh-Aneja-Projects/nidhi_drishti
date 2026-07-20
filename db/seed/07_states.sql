-- States and union territories (docs/12), plus the two state treasury sources
-- the v2 line actually targets and the entity aliases that resolve their names.
--
-- Names, kind (state vs union territory), region grouping and whether a body has
-- a legislature are public reference facts, written here from knowledge the same
-- way ministry names are in 03_ministries.sql. No rupee figure appears in this
-- file: state allocation and expenditure amounts live only in fiscal_fact and
-- must always trace to a source_record (CLAUDE.md principle 1).
--
-- Stable ids follow the 'st-karnataka' shape fixed by the CHECK in
-- db/migrations/0011. region is our editorial grouping for the dashboard and has
-- no official status.

INSERT INTO state (state_id, name, kind, region, has_legislature) VALUES
  -- The 28 states.
  ('st-andhra-pradesh',   'Andhra Pradesh',    'state', 'South',     TRUE),
  ('st-arunachal-pradesh','Arunachal Pradesh', 'state', 'Northeast', TRUE),
  ('st-assam',            'Assam',             'state', 'Northeast', TRUE),
  ('st-bihar',            'Bihar',             'state', 'East',      TRUE),
  ('st-chhattisgarh',     'Chhattisgarh',      'state', 'Central',   TRUE),
  ('st-goa',              'Goa',               'state', 'West',      TRUE),
  ('st-gujarat',          'Gujarat',           'state', 'West',      TRUE),
  ('st-haryana',          'Haryana',           'state', 'North',     TRUE),
  ('st-himachal-pradesh', 'Himachal Pradesh',  'state', 'North',     TRUE),
  ('st-jharkhand',        'Jharkhand',         'state', 'East',      TRUE),
  ('st-karnataka',        'Karnataka',         'state', 'South',     TRUE),
  ('st-kerala',           'Kerala',            'state', 'South',     TRUE),
  ('st-madhya-pradesh',   'Madhya Pradesh',    'state', 'Central',   TRUE),
  ('st-maharashtra',      'Maharashtra',       'state', 'West',      TRUE),
  ('st-manipur',          'Manipur',           'state', 'Northeast', TRUE),
  ('st-meghalaya',        'Meghalaya',         'state', 'Northeast', TRUE),
  ('st-mizoram',          'Mizoram',           'state', 'Northeast', TRUE),
  ('st-nagaland',         'Nagaland',          'state', 'Northeast', TRUE),
  ('st-odisha',           'Odisha',            'state', 'East',      TRUE),
  ('st-punjab',           'Punjab',            'state', 'North',     TRUE),
  ('st-rajasthan',        'Rajasthan',         'state', 'North',     TRUE),
  ('st-sikkim',           'Sikkim',            'state', 'Northeast', TRUE),
  ('st-tamil-nadu',       'Tamil Nadu',        'state', 'South',     TRUE),
  ('st-telangana',        'Telangana',         'state', 'South',     TRUE),
  ('st-tripura',          'Tripura',           'state', 'Northeast', TRUE),
  ('st-uttar-pradesh',    'Uttar Pradesh',     'state', 'North',     TRUE),
  ('st-uttarakhand',      'Uttarakhand',       'state', 'North',     TRUE),
  ('st-west-bengal',      'West Bengal',       'state', 'East',      TRUE),

  -- The 8 union territories. Delhi, Puducherry and Jammu and Kashmir have
  -- legislative assemblies and publish their own budgets; the other five have
  -- no legislature and their expenditure runs through the Union budget, which is
  -- why has_legislature is recorded rather than assumed.
  ('st-andaman-nicobar',  'Andaman and Nicobar Islands', 'ut', 'Islands',   FALSE),
  ('st-chandigarh',       'Chandigarh',                  'ut', 'North',     FALSE),
  ('st-dadra-nagar-haveli-daman-diu',
                          'Dadra and Nagar Haveli and Daman and Diu', 'ut', 'West', FALSE),
  ('st-delhi',            'Delhi',                       'ut', 'North',     TRUE),
  ('st-jammu-kashmir',    'Jammu and Kashmir',           'ut', 'North',     TRUE),
  ('st-ladakh',           'Ladakh',                      'ut', 'North',     FALSE),
  ('st-lakshadweep',      'Lakshadweep',                 'ut', 'Islands',   FALSE),
  ('st-puducherry',       'Puducherry',                  'ut', 'South',     TRUE)

ON CONFLICT (state_id) DO UPDATE SET
  name            = EXCLUDED.name,
  kind            = EXCLUDED.kind,
  region          = EXCLUDED.region,
  has_legislature = EXCLUDED.has_legislature;

-- ---------------------------------------------------------------------------
-- Source registry rows for the two portals the v2 line targets (docs/12).
--
-- jurisdiction = 'state' is what marks every fact from these sources as
-- belonging to the state ledger, which the CSS double-count invariant in 0011
-- keys off. Access notes are honest: the exact document URLs are unverified, so
-- the pipelines hold them in one constant and fail loudly on a 404 or a moved
-- table rather than writing a guess.
-- ---------------------------------------------------------------------------
INSERT INTO source_registry
  (source_id, name, tier, cadence, method, format, homepage_url,
   license_note, access_note, expected_interval_hours, jurisdiction)
VALUES
  ('state_karnataka', 'Karnataka State Budget, Finance Department', 1, 'annual',
   'download', 'HTML/PDF', 'https://finance.karnataka.gov.in/',
   'Government of Karnataka published budget documents. Reuse permitted under the National Data Sharing and Accessibility Policy with attribution to the Finance Department, Government of Karnataka.',
   'Budget at a Glance and the Medium Term Fiscal Plan are published each February or March. The exact document path is not verified in code: the pipeline holds candidate URLs in one constant and raises a drift alert on a 404 or a restructured table rather than writing anything.',
   24 * 90, 'state'),

  ('state_odisha', 'Odisha State Budget, Finance Department', 1, 'annual',
   'download', 'HTML/PDF', 'https://finance.odisha.gov.in/',
   'Government of Odisha published budget documents. Reuse permitted under NDSAP with attribution to the Finance Department, Government of Odisha. Odisha also mirrors budget data on its Odisha Budget portal.',
   'Budget at a Glance is published with the annual budget, usually in February. The exact document path is not verified in code: the pipeline holds candidate URLs in one constant and raises a drift alert on a 404 or a restructured table rather than writing anything.',
   24 * 90, 'state')

ON CONFLICT (source_id) DO UPDATE SET
  name         = EXCLUDED.name,
  tier         = EXCLUDED.tier,
  cadence      = EXCLUDED.cadence,
  method       = EXCLUDED.method,
  format       = EXCLUDED.format,
  homepage_url = EXCLUDED.homepage_url,
  license_note = EXCLUDED.license_note,
  access_note  = EXCLUDED.access_note,
  expected_interval_hours = EXCLUDED.expected_interval_hours,
  jurisdiction = EXCLUDED.jurisdiction;

-- ---------------------------------------------------------------------------
-- Entity aliases for the two targeted states. Hand-verified name variants, so
-- resolved_by = 'seed' and confidence = 1.0, mirroring 05_entity_aliases.sql.
-- These are what let "Government of Karnataka" in a budget document resolve to
-- st-karnataka. ON CONFLICT DO NOTHING keeps a seeded mapping authoritative.
-- ---------------------------------------------------------------------------
INSERT INTO entity_alias (alias, entity_type, entity_id, confidence, resolved_by) VALUES
  ('Karnataka',                 'state', 'st-karnataka', 1.0, 'seed'),
  ('State of Karnataka',        'state', 'st-karnataka', 1.0, 'seed'),
  ('Government of Karnataka',    'state', 'st-karnataka', 1.0, 'seed'),
  ('GoK',                       'state', 'st-karnataka', 1.0, 'seed'),

  ('Odisha',                    'state', 'st-odisha', 1.0, 'seed'),
  ('State of Odisha',           'state', 'st-odisha', 1.0, 'seed'),
  ('Government of Odisha',       'state', 'st-odisha', 1.0, 'seed'),
  ('Orissa',                    'state', 'st-odisha', 1.0, 'seed'),
  ('GoO',                       'state', 'st-odisha', 1.0, 'seed')

ON CONFLICT (alias, entity_type) DO NOTHING;
