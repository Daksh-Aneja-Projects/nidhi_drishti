-- Ministries and departments of the Union Government (docs/03 tier 3 reference
-- data). Ministry NAMES are public reference facts and are written here from
-- knowledge, same as the source registry; no rupee figure ever appears in this
-- file (CLAUDE.md principle 1 concerns fiscal facts, not the name of a
-- department).
--
-- Several ministries publish their Demands for Grants by department rather
-- than by ministry (Finance, Defence, Health, Education, Jal Shakti,
-- Communications), so those departments get their own stable ministry_id here
-- too. That mirrors how the budget documents and CGA accounts actually key
-- the data, which is what entity resolution has to match against.
--
-- sector is our editorial grouping into twelve verticals for the dashboard's
-- sector view; it has no official status.

INSERT INTO ministry (ministry_id, name, sector) VALUES
  -- Agriculture and rural
  ('min-agriculture', 'Ministry of Agriculture and Farmers Welfare', 'Agriculture and rural'),
  ('min-rural-development', 'Ministry of Rural Development', 'Agriculture and rural'),
  ('min-panchayati-raj', 'Ministry of Panchayati Raj', 'Agriculture and rural'),
  ('min-fisheries-animal-husbandry-dairying', 'Ministry of Fisheries, Animal Husbandry and Dairying', 'Agriculture and rural'),
  ('min-food-processing-industries', 'Ministry of Food Processing Industries', 'Agriculture and rural'),
  ('min-cooperation', 'Ministry of Cooperation', 'Agriculture and rural'),
  ('min-consumer-affairs-food-pds', 'Ministry of Consumer Affairs, Food and Public Distribution', 'Agriculture and rural'),

  -- Defence and security
  ('min-defence', 'Ministry of Defence', 'Defence and security'),
  ('min-defence-production', 'Department of Defence Production', 'Defence and security'),
  ('min-home-affairs', 'Ministry of Home Affairs', 'Defence and security'),

  -- Social sector
  ('min-health-family-welfare', 'Ministry of Health and Family Welfare', 'Social sector'),
  ('min-health-research', 'Department of Health Research', 'Social sector'),
  ('min-education-school', 'Department of School Education and Literacy', 'Social sector'),
  ('min-education-higher', 'Department of Higher Education', 'Social sector'),
  ('min-women-child-development', 'Ministry of Women and Child Development', 'Social sector'),
  ('min-social-justice-empowerment', 'Ministry of Social Justice and Empowerment', 'Social sector'),
  ('min-tribal-affairs', 'Ministry of Tribal Affairs', 'Social sector'),
  ('min-minority-affairs', 'Ministry of Minority Affairs', 'Social sector'),
  ('min-labour-employment', 'Ministry of Labour and Employment', 'Social sector'),
  ('min-ayush', 'Ministry of Ayush', 'Social sector'),
  ('min-skill-development-entrepreneurship', 'Ministry of Skill Development and Entrepreneurship', 'Social sector'),
  ('min-youth-affairs-sports', 'Ministry of Youth Affairs and Sports', 'Social sector'),
  ('min-personnel-public-grievances-pensions', 'Ministry of Personnel, Public Grievances and Pensions', 'Social sector'),

  -- Infrastructure
  ('min-road-transport-highways', 'Ministry of Road Transport and Highways', 'Infrastructure'),
  ('min-railways', 'Ministry of Railways', 'Infrastructure'),
  ('min-housing-urban-affairs', 'Ministry of Housing and Urban Affairs', 'Infrastructure'),
  ('min-civil-aviation', 'Ministry of Civil Aviation', 'Infrastructure'),
  ('min-jal-shakti-water-resources', 'Department of Water Resources, River Development and Ganga Rejuvenation', 'Infrastructure'),
  ('min-jal-shakti-drinking-water-sanitation', 'Department of Drinking Water and Sanitation', 'Infrastructure'),
  ('min-communications-telecom', 'Department of Telecommunications', 'Infrastructure'),

  -- Energy
  ('min-power', 'Ministry of Power', 'Energy'),
  ('min-petroleum-natural-gas', 'Ministry of Petroleum and Natural Gas', 'Energy'),
  ('min-coal', 'Ministry of Coal', 'Energy'),
  ('min-new-renewable-energy', 'Ministry of New and Renewable Energy', 'Energy'),
  ('min-atomic-energy', 'Department of Atomic Energy', 'Energy'),

  -- Industry and commerce
  ('min-commerce', 'Department of Commerce', 'Industry and commerce'),
  ('min-industry-internal-trade', 'Department for Promotion of Industry and Internal Trade', 'Industry and commerce'),
  ('min-msme', 'Ministry of Micro, Small and Medium Enterprises', 'Industry and commerce'),
  ('min-heavy-industries', 'Ministry of Heavy Industries', 'Industry and commerce'),
  ('min-steel', 'Ministry of Steel', 'Industry and commerce'),
  ('min-mines', 'Ministry of Mines', 'Industry and commerce'),
  ('min-textiles', 'Ministry of Textiles', 'Industry and commerce'),
  ('min-corporate-affairs', 'Ministry of Corporate Affairs', 'Industry and commerce'),

  -- Science and technology
  ('min-science-technology', 'Department of Science and Technology', 'Science and technology'),
  ('min-biotechnology', 'Department of Biotechnology', 'Science and technology'),
  ('min-electronics-it', 'Ministry of Electronics and Information Technology', 'Science and technology'),
  ('min-space', 'Department of Space', 'Science and technology'),
  ('min-earth-sciences', 'Ministry of Earth Sciences', 'Science and technology'),

  -- Governance
  ('min-law-justice', 'Ministry of Law and Justice', 'Governance'),
  ('min-statistics-programme-implementation', 'Ministry of Statistics and Programme Implementation', 'Governance'),
  ('min-doner', 'Ministry of Development of North Eastern Region', 'Governance'),
  ('min-information-broadcasting', 'Ministry of Information and Broadcasting', 'Governance'),

  -- Finance
  ('min-economic-affairs', 'Department of Economic Affairs', 'Finance'),
  ('min-expenditure', 'Department of Expenditure', 'Finance'),
  ('min-revenue', 'Department of Revenue', 'Finance'),
  ('min-financial-services', 'Department of Financial Services', 'Finance'),

  -- Environment
  ('min-environment-forest-climate-change', 'Ministry of Environment, Forest and Climate Change', 'Environment'),

  -- Culture and tourism
  ('min-culture', 'Ministry of Culture', 'Culture and tourism'),
  ('min-tourism', 'Ministry of Tourism', 'Culture and tourism'),

  -- External affairs
  ('min-external-affairs', 'Ministry of External Affairs', 'External affairs')

ON CONFLICT (ministry_id) DO UPDATE SET
  name   = EXCLUDED.name,
  sector = EXCLUDED.sector;
