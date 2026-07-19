-- Entity aliases (docs/04 section 2): every alternative way a ministry or
-- scheme name shows up across budget documents, tenders, PIB releases and
-- news coverage, mapped to the stable ids seeded in 03_ministries.sql and
-- 04_schemes.sql. This table is the backbone of entity resolution, so it
-- leans generous on abbreviations, ampersand variants, and the "M/o" / "D/o"
-- prefixes that Government of India documents use interchangeably with the
-- full "Ministry of" / "Department of" form.
--
-- All rows here are hand-verified name variants, not machine guesses, hence
-- resolved_by = 'seed' and confidence = 1.0 throughout. source_id is left
-- NULL: these aliases were not observed in one specific fetched document, they
-- are known naming conventions seeded ahead of ingestion.
--
-- ON CONFLICT DO NOTHING: a later pipeline run may propose the same alias
-- through the trigram resolver: the hand-seeded, fully-confident mapping
-- always wins and is never downgraded.

-- ---------------------------------------------------------------------------
-- Ministry and department aliases
-- ---------------------------------------------------------------------------
INSERT INTO entity_alias (alias, entity_type, entity_id, confidence, resolved_by) VALUES
  ('Ministry of Agriculture & Farmers Welfare', 'ministry', 'min-agriculture', 1.0, 'seed'),
  ('M/o Agriculture and Farmers Welfare', 'ministry', 'min-agriculture', 1.0, 'seed'),
  ('M/o Agriculture & Farmers Welfare', 'ministry', 'min-agriculture', 1.0, 'seed'),
  ('MoA&FW', 'ministry', 'min-agriculture', 1.0, 'seed'),
  ('Department of Agriculture and Farmers Welfare', 'ministry', 'min-agriculture', 1.0, 'seed'),
  ('Ministry of Agriculture', 'ministry', 'min-agriculture', 1.0, 'seed'),

  ('M/o Rural Development', 'ministry', 'min-rural-development', 1.0, 'seed'),
  ('MoRD', 'ministry', 'min-rural-development', 1.0, 'seed'),
  ('Department of Rural Development', 'ministry', 'min-rural-development', 1.0, 'seed'),
  ('Rural Development Ministry', 'ministry', 'min-rural-development', 1.0, 'seed'),

  ('M/o Panchayati Raj', 'ministry', 'min-panchayati-raj', 1.0, 'seed'),
  ('MoPR', 'ministry', 'min-panchayati-raj', 1.0, 'seed'),
  ('Department of Panchayati Raj', 'ministry', 'min-panchayati-raj', 1.0, 'seed'),

  ('Ministry of Fisheries, Animal Husbandry & Dairying', 'ministry', 'min-fisheries-animal-husbandry-dairying', 1.0, 'seed'),
  ('M/o Fisheries, Animal Husbandry and Dairying', 'ministry', 'min-fisheries-animal-husbandry-dairying', 1.0, 'seed'),
  ('MoFAHD', 'ministry', 'min-fisheries-animal-husbandry-dairying', 1.0, 'seed'),
  ('Department of Animal Husbandry and Dairying', 'ministry', 'min-fisheries-animal-husbandry-dairying', 1.0, 'seed'),
  ('Department of Fisheries', 'ministry', 'min-fisheries-animal-husbandry-dairying', 1.0, 'seed'),

  ('M/o Food Processing Industries', 'ministry', 'min-food-processing-industries', 1.0, 'seed'),
  ('MoFPI', 'ministry', 'min-food-processing-industries', 1.0, 'seed'),
  ('Ministry of Food Processing', 'ministry', 'min-food-processing-industries', 1.0, 'seed'),

  ('M/o Cooperation', 'ministry', 'min-cooperation', 1.0, 'seed'),
  ('Department of Cooperation', 'ministry', 'min-cooperation', 1.0, 'seed'),
  ('Ministry of Co-operation', 'ministry', 'min-cooperation', 1.0, 'seed'),

  ('Ministry of Consumer Affairs, Food & Public Distribution', 'ministry', 'min-consumer-affairs-food-pds', 1.0, 'seed'),
  ('M/o Consumer Affairs, Food and Public Distribution', 'ministry', 'min-consumer-affairs-food-pds', 1.0, 'seed'),
  ('Department of Food and Public Distribution', 'ministry', 'min-consumer-affairs-food-pds', 1.0, 'seed'),
  ('Department of Consumer Affairs', 'ministry', 'min-consumer-affairs-food-pds', 1.0, 'seed'),
  ('MoCAF&PD', 'ministry', 'min-consumer-affairs-food-pds', 1.0, 'seed'),

  ('M/o Defence', 'ministry', 'min-defence', 1.0, 'seed'),
  ('MoD', 'ministry', 'min-defence', 1.0, 'seed'),
  ('Department of Defence', 'ministry', 'min-defence', 1.0, 'seed'),
  ('Defence Ministry', 'ministry', 'min-defence', 1.0, 'seed'),

  ('Dept. of Defence Production', 'ministry', 'min-defence-production', 1.0, 'seed'),
  ('D/o Defence Production', 'ministry', 'min-defence-production', 1.0, 'seed'),
  ('DDP', 'ministry', 'min-defence-production', 1.0, 'seed'),

  ('M/o Home Affairs', 'ministry', 'min-home-affairs', 1.0, 'seed'),
  ('MHA', 'ministry', 'min-home-affairs', 1.0, 'seed'),
  ('Home Ministry', 'ministry', 'min-home-affairs', 1.0, 'seed'),
  ('Department of Home Affairs', 'ministry', 'min-home-affairs', 1.0, 'seed'),

  ('Ministry of Health & Family Welfare', 'ministry', 'min-health-family-welfare', 1.0, 'seed'),
  ('M/o Health and Family Welfare', 'ministry', 'min-health-family-welfare', 1.0, 'seed'),
  ('M/o Health & Family Welfare', 'ministry', 'min-health-family-welfare', 1.0, 'seed'),
  ('MoHFW', 'ministry', 'min-health-family-welfare', 1.0, 'seed'),
  ('Dept. of Health and Family Welfare', 'ministry', 'min-health-family-welfare', 1.0, 'seed'),
  ('Department of Health & Family Welfare', 'ministry', 'min-health-family-welfare', 1.0, 'seed'),

  ('Dept. of Health Research', 'ministry', 'min-health-research', 1.0, 'seed'),
  ('D/o Health Research', 'ministry', 'min-health-research', 1.0, 'seed'),
  ('DHR', 'ministry', 'min-health-research', 1.0, 'seed'),

  ('Dept. of School Education & Literacy', 'ministry', 'min-education-school', 1.0, 'seed'),
  ('D/o School Education and Literacy', 'ministry', 'min-education-school', 1.0, 'seed'),
  ('Department of School Education', 'ministry', 'min-education-school', 1.0, 'seed'),
  ('Ministry of Education (School Education)', 'ministry', 'min-education-school', 1.0, 'seed'),

  ('Dept. of Higher Education', 'ministry', 'min-education-higher', 1.0, 'seed'),
  ('D/o Higher Education', 'ministry', 'min-education-higher', 1.0, 'seed'),
  ('Ministry of Education (Higher Education)', 'ministry', 'min-education-higher', 1.0, 'seed'),

  ('Ministry of Women & Child Development', 'ministry', 'min-women-child-development', 1.0, 'seed'),
  ('M/o Women and Child Development', 'ministry', 'min-women-child-development', 1.0, 'seed'),
  ('WCD Ministry', 'ministry', 'min-women-child-development', 1.0, 'seed'),
  ('MWCD', 'ministry', 'min-women-child-development', 1.0, 'seed'),

  ('Ministry of Social Justice & Empowerment', 'ministry', 'min-social-justice-empowerment', 1.0, 'seed'),
  ('M/o Social Justice and Empowerment', 'ministry', 'min-social-justice-empowerment', 1.0, 'seed'),
  ('MoSJE', 'ministry', 'min-social-justice-empowerment', 1.0, 'seed'),

  ('M/o Tribal Affairs', 'ministry', 'min-tribal-affairs', 1.0, 'seed'),
  ('MoTA', 'ministry', 'min-tribal-affairs', 1.0, 'seed'),
  ('Department of Tribal Affairs', 'ministry', 'min-tribal-affairs', 1.0, 'seed'),

  ('M/o Minority Affairs', 'ministry', 'min-minority-affairs', 1.0, 'seed'),
  ('MoMA', 'ministry', 'min-minority-affairs', 1.0, 'seed'),
  ('Ministry of Minorities Affairs', 'ministry', 'min-minority-affairs', 1.0, 'seed'),

  ('Ministry of Labour & Employment', 'ministry', 'min-labour-employment', 1.0, 'seed'),
  ('M/o Labour and Employment', 'ministry', 'min-labour-employment', 1.0, 'seed'),
  ('MoLE', 'ministry', 'min-labour-employment', 1.0, 'seed'),

  ('M/o AYUSH', 'ministry', 'min-ayush', 1.0, 'seed'),
  ('Ministry of AYUSH', 'ministry', 'min-ayush', 1.0, 'seed'),
  ('Department of AYUSH', 'ministry', 'min-ayush', 1.0, 'seed'),

  ('Ministry of Skill Development & Entrepreneurship', 'ministry', 'min-skill-development-entrepreneurship', 1.0, 'seed'),
  ('M/o Skill Development and Entrepreneurship', 'ministry', 'min-skill-development-entrepreneurship', 1.0, 'seed'),
  ('MSDE', 'ministry', 'min-skill-development-entrepreneurship', 1.0, 'seed'),

  ('Ministry of Youth Affairs & Sports', 'ministry', 'min-youth-affairs-sports', 1.0, 'seed'),
  ('M/o Youth Affairs and Sports', 'ministry', 'min-youth-affairs-sports', 1.0, 'seed'),
  ('MYAS', 'ministry', 'min-youth-affairs-sports', 1.0, 'seed'),
  ('Department of Sports', 'ministry', 'min-youth-affairs-sports', 1.0, 'seed'),

  ('Ministry of Personnel, Public Grievances & Pensions', 'ministry', 'min-personnel-public-grievances-pensions', 1.0, 'seed'),
  ('M/o Personnel, Public Grievances and Pensions', 'ministry', 'min-personnel-public-grievances-pensions', 1.0, 'seed'),
  ('DoPT', 'ministry', 'min-personnel-public-grievances-pensions', 1.0, 'seed'),
  ('Department of Personnel and Training', 'ministry', 'min-personnel-public-grievances-pensions', 1.0, 'seed'),

  ('Ministry of Road Transport & Highways', 'ministry', 'min-road-transport-highways', 1.0, 'seed'),
  ('M/o Road Transport and Highways', 'ministry', 'min-road-transport-highways', 1.0, 'seed'),
  ('MoRTH', 'ministry', 'min-road-transport-highways', 1.0, 'seed'),

  ('M/o Railways', 'ministry', 'min-railways', 1.0, 'seed'),
  ('Indian Railways', 'ministry', 'min-railways', 1.0, 'seed'),
  ('Railway Ministry', 'ministry', 'min-railways', 1.0, 'seed'),

  ('Ministry of Housing & Urban Affairs', 'ministry', 'min-housing-urban-affairs', 1.0, 'seed'),
  ('M/o Housing and Urban Affairs', 'ministry', 'min-housing-urban-affairs', 1.0, 'seed'),
  ('MoHUA', 'ministry', 'min-housing-urban-affairs', 1.0, 'seed'),

  ('M/o Civil Aviation', 'ministry', 'min-civil-aviation', 1.0, 'seed'),
  ('MoCA', 'ministry', 'min-civil-aviation', 1.0, 'seed'),
  ('Department of Civil Aviation', 'ministry', 'min-civil-aviation', 1.0, 'seed'),

  ('Dept. of Water Resources, River Development & Ganga Rejuvenation', 'ministry', 'min-jal-shakti-water-resources', 1.0, 'seed'),
  ('D/o Water Resources, River Development and Ganga Rejuvenation', 'ministry', 'min-jal-shakti-water-resources', 1.0, 'seed'),
  ('Ministry of Jal Shakti (Water Resources)', 'ministry', 'min-jal-shakti-water-resources', 1.0, 'seed'),
  ('DoWR, RD & GR', 'ministry', 'min-jal-shakti-water-resources', 1.0, 'seed'),

  ('Dept. of Drinking Water & Sanitation', 'ministry', 'min-jal-shakti-drinking-water-sanitation', 1.0, 'seed'),
  ('D/o Drinking Water and Sanitation', 'ministry', 'min-jal-shakti-drinking-water-sanitation', 1.0, 'seed'),
  ('Ministry of Jal Shakti (Drinking Water and Sanitation)', 'ministry', 'min-jal-shakti-drinking-water-sanitation', 1.0, 'seed'),
  ('DDWS', 'ministry', 'min-jal-shakti-drinking-water-sanitation', 1.0, 'seed'),

  ('Dept. of Telecommunications', 'ministry', 'min-communications-telecom', 1.0, 'seed'),
  ('D/o Telecommunications', 'ministry', 'min-communications-telecom', 1.0, 'seed'),
  ('DoT', 'ministry', 'min-communications-telecom', 1.0, 'seed'),
  ('Ministry of Communications (Telecom)', 'ministry', 'min-communications-telecom', 1.0, 'seed'),

  ('M/o Power', 'ministry', 'min-power', 1.0, 'seed'),
  ('Power Ministry', 'ministry', 'min-power', 1.0, 'seed'),
  ('Department of Power', 'ministry', 'min-power', 1.0, 'seed'),

  ('Ministry of Petroleum & Natural Gas', 'ministry', 'min-petroleum-natural-gas', 1.0, 'seed'),
  ('M/o Petroleum and Natural Gas', 'ministry', 'min-petroleum-natural-gas', 1.0, 'seed'),
  ('MoPNG', 'ministry', 'min-petroleum-natural-gas', 1.0, 'seed'),

  ('M/o Coal', 'ministry', 'min-coal', 1.0, 'seed'),
  ('Coal Ministry', 'ministry', 'min-coal', 1.0, 'seed'),
  ('Department of Coal', 'ministry', 'min-coal', 1.0, 'seed'),

  ('Ministry of New & Renewable Energy', 'ministry', 'min-new-renewable-energy', 1.0, 'seed'),
  ('M/o New and Renewable Energy', 'ministry', 'min-new-renewable-energy', 1.0, 'seed'),
  ('MNRE', 'ministry', 'min-new-renewable-energy', 1.0, 'seed'),

  ('Dept. of Atomic Energy', 'ministry', 'min-atomic-energy', 1.0, 'seed'),
  ('D/o Atomic Energy', 'ministry', 'min-atomic-energy', 1.0, 'seed'),
  ('DAE', 'ministry', 'min-atomic-energy', 1.0, 'seed'),

  ('Dept. of Commerce', 'ministry', 'min-commerce', 1.0, 'seed'),
  ('D/o Commerce', 'ministry', 'min-commerce', 1.0, 'seed'),
  ('Ministry of Commerce', 'ministry', 'min-commerce', 1.0, 'seed'),

  ('DPIIT', 'ministry', 'min-industry-internal-trade', 1.0, 'seed'),
  ('Dept. for Promotion of Industry & Internal Trade', 'ministry', 'min-industry-internal-trade', 1.0, 'seed'),
  ('Department of Industrial Policy and Promotion', 'ministry', 'min-industry-internal-trade', 1.0, 'seed'),
  ('Ministry of Commerce and Industry (DPIIT)', 'ministry', 'min-industry-internal-trade', 1.0, 'seed'),

  ('Ministry of Micro, Small & Medium Enterprises', 'ministry', 'min-msme', 1.0, 'seed'),
  ('M/o MSME', 'ministry', 'min-msme', 1.0, 'seed'),
  ('M/o Micro, Small and Medium Enterprises', 'ministry', 'min-msme', 1.0, 'seed'),
  ('MoMSME', 'ministry', 'min-msme', 1.0, 'seed'),

  ('M/o Heavy Industries', 'ministry', 'min-heavy-industries', 1.0, 'seed'),
  ('Department of Heavy Industry', 'ministry', 'min-heavy-industries', 1.0, 'seed'),
  ('Heavy Industries Ministry', 'ministry', 'min-heavy-industries', 1.0, 'seed'),

  ('M/o Steel', 'ministry', 'min-steel', 1.0, 'seed'),
  ('Steel Ministry', 'ministry', 'min-steel', 1.0, 'seed'),
  ('Department of Steel', 'ministry', 'min-steel', 1.0, 'seed'),

  ('M/o Mines', 'ministry', 'min-mines', 1.0, 'seed'),
  ('Department of Mines', 'ministry', 'min-mines', 1.0, 'seed'),
  ('Mines Ministry', 'ministry', 'min-mines', 1.0, 'seed'),

  ('M/o Textiles', 'ministry', 'min-textiles', 1.0, 'seed'),
  ('Department of Textiles', 'ministry', 'min-textiles', 1.0, 'seed'),
  ('Textiles Ministry', 'ministry', 'min-textiles', 1.0, 'seed'),

  ('M/o Corporate Affairs', 'ministry', 'min-corporate-affairs', 1.0, 'seed'),
  ('MCA', 'ministry', 'min-corporate-affairs', 1.0, 'seed'),
  ('Department of Corporate Affairs', 'ministry', 'min-corporate-affairs', 1.0, 'seed'),

  ('Dept. of Science & Technology', 'ministry', 'min-science-technology', 1.0, 'seed'),
  ('D/o Science and Technology', 'ministry', 'min-science-technology', 1.0, 'seed'),
  ('DST', 'ministry', 'min-science-technology', 1.0, 'seed'),

  ('Dept. of Biotechnology', 'ministry', 'min-biotechnology', 1.0, 'seed'),
  ('D/o Biotechnology', 'ministry', 'min-biotechnology', 1.0, 'seed'),
  ('DBT', 'ministry', 'min-biotechnology', 1.0, 'seed'),

  ('Ministry of Electronics & Information Technology', 'ministry', 'min-electronics-it', 1.0, 'seed'),
  ('M/o Electronics and Information Technology', 'ministry', 'min-electronics-it', 1.0, 'seed'),
  ('MeitY', 'ministry', 'min-electronics-it', 1.0, 'seed'),
  ('Department of Electronics and Information Technology', 'ministry', 'min-electronics-it', 1.0, 'seed'),

  ('Dept. of Space', 'ministry', 'min-space', 1.0, 'seed'),
  ('D/o Space', 'ministry', 'min-space', 1.0, 'seed'),
  ('DOS', 'ministry', 'min-space', 1.0, 'seed'),
  ('ISRO (Department of Space)', 'ministry', 'min-space', 1.0, 'seed'),

  ('M/o Earth Sciences', 'ministry', 'min-earth-sciences', 1.0, 'seed'),
  ('MoES', 'ministry', 'min-earth-sciences', 1.0, 'seed'),
  ('Department of Earth Sciences', 'ministry', 'min-earth-sciences', 1.0, 'seed'),

  ('Ministry of Law & Justice', 'ministry', 'min-law-justice', 1.0, 'seed'),
  ('M/o Law and Justice', 'ministry', 'min-law-justice', 1.0, 'seed'),
  ('Department of Legal Affairs', 'ministry', 'min-law-justice', 1.0, 'seed'),

  ('Ministry of Statistics & Programme Implementation', 'ministry', 'min-statistics-programme-implementation', 1.0, 'seed'),
  ('M/o Statistics and Programme Implementation', 'ministry', 'min-statistics-programme-implementation', 1.0, 'seed'),
  ('MoSPI', 'ministry', 'min-statistics-programme-implementation', 1.0, 'seed'),

  ('M/o Development of North Eastern Region', 'ministry', 'min-doner', 1.0, 'seed'),
  ('MDoNER', 'ministry', 'min-doner', 1.0, 'seed'),
  ('DoNER', 'ministry', 'min-doner', 1.0, 'seed'),

  ('Ministry of Information & Broadcasting', 'ministry', 'min-information-broadcasting', 1.0, 'seed'),
  ('M/o Information and Broadcasting', 'ministry', 'min-information-broadcasting', 1.0, 'seed'),
  ('MIB', 'ministry', 'min-information-broadcasting', 1.0, 'seed'),
  ('I&B Ministry', 'ministry', 'min-information-broadcasting', 1.0, 'seed'),

  ('Dept. of Economic Affairs', 'ministry', 'min-economic-affairs', 1.0, 'seed'),
  ('D/o Economic Affairs', 'ministry', 'min-economic-affairs', 1.0, 'seed'),
  ('DEA', 'ministry', 'min-economic-affairs', 1.0, 'seed'),

  ('Dept. of Expenditure', 'ministry', 'min-expenditure', 1.0, 'seed'),
  ('D/o Expenditure', 'ministry', 'min-expenditure', 1.0, 'seed'),
  ('DoE (Expenditure)', 'ministry', 'min-expenditure', 1.0, 'seed'),

  ('Dept. of Revenue', 'ministry', 'min-revenue', 1.0, 'seed'),
  ('D/o Revenue', 'ministry', 'min-revenue', 1.0, 'seed'),
  ('DoR', 'ministry', 'min-revenue', 1.0, 'seed'),

  ('Dept. of Financial Services', 'ministry', 'min-financial-services', 1.0, 'seed'),
  ('D/o Financial Services', 'ministry', 'min-financial-services', 1.0, 'seed'),
  ('DFS', 'ministry', 'min-financial-services', 1.0, 'seed'),

  ('Ministry of Environment, Forest & Climate Change', 'ministry', 'min-environment-forest-climate-change', 1.0, 'seed'),
  ('M/o Environment, Forest and Climate Change', 'ministry', 'min-environment-forest-climate-change', 1.0, 'seed'),
  ('MoEFCC', 'ministry', 'min-environment-forest-climate-change', 1.0, 'seed'),

  ('M/o Culture', 'ministry', 'min-culture', 1.0, 'seed'),
  ('Culture Ministry', 'ministry', 'min-culture', 1.0, 'seed'),
  ('Department of Culture', 'ministry', 'min-culture', 1.0, 'seed'),

  ('M/o Tourism', 'ministry', 'min-tourism', 1.0, 'seed'),
  ('Department of Tourism', 'ministry', 'min-tourism', 1.0, 'seed'),
  ('Tourism Ministry', 'ministry', 'min-tourism', 1.0, 'seed'),

  ('M/o External Affairs', 'ministry', 'min-external-affairs', 1.0, 'seed'),
  ('MEA', 'ministry', 'min-external-affairs', 1.0, 'seed'),
  ('Foreign Ministry', 'ministry', 'min-external-affairs', 1.0, 'seed')

ON CONFLICT (alias, entity_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Scheme aliases
-- ---------------------------------------------------------------------------
INSERT INTO entity_alias (alias, entity_type, entity_id, confidence, resolved_by) VALUES
  ('PM Kisan', 'scheme', 'sch-pm-kisan', 1.0, 'seed'),
  ('PM-KISAN Yojana', 'scheme', 'sch-pm-kisan', 1.0, 'seed'),
  ('Pradhan Mantri Kisan Samman Nidhi Yojana', 'scheme', 'sch-pm-kisan', 1.0, 'seed'),

  ('PMFBY', 'scheme', 'sch-pmfby', 1.0, 'seed'),
  ('Fasal Bima Yojana', 'scheme', 'sch-pmfby', 1.0, 'seed'),

  ('PM-KMY', 'scheme', 'sch-pm-kisan-maandhan', 1.0, 'seed'),
  ('Kisan Pension Yojana', 'scheme', 'sch-pm-kisan-maandhan', 1.0, 'seed'),

  ('Interest Subvention Scheme', 'scheme', 'sch-kcc-interest-subvention', 1.0, 'seed'),
  ('ISS for Kisan Credit Card', 'scheme', 'sch-kcc-interest-subvention', 1.0, 'seed'),

  ('RKVY', 'scheme', 'sch-rkvy', 1.0, 'seed'),
  ('Rashtriya Krishi Vikas Yojna', 'scheme', 'sch-rkvy', 1.0, 'seed'),

  ('Drone Didi Scheme', 'scheme', 'sch-namo-drone-didi', 1.0, 'seed'),
  ('NAMO Drone Didi', 'scheme', 'sch-namo-drone-didi', 1.0, 'seed'),

  ('MGNREGS', 'scheme', 'sch-mgnrega', 1.0, 'seed'),
  ('NREGA', 'scheme', 'sch-mgnrega', 1.0, 'seed'),
  ('Mahatma Gandhi NREGA', 'scheme', 'sch-mgnrega', 1.0, 'seed'),
  ('MGNREGA', 'scheme', 'sch-mgnrega', 1.0, 'seed'),

  ('PMAY-G', 'scheme', 'sch-pmay-gramin', 1.0, 'seed'),
  ('PMAY(G)', 'scheme', 'sch-pmay-gramin', 1.0, 'seed'),

  ('PMGSY', 'scheme', 'sch-pmgsy', 1.0, 'seed'),
  ('Gram Sadak Yojana', 'scheme', 'sch-pmgsy', 1.0, 'seed'),

  ('DAY-NRLM', 'scheme', 'sch-nrlm', 1.0, 'seed'),
  ('NRLM', 'scheme', 'sch-nrlm', 1.0, 'seed'),
  ('Ajeevika', 'scheme', 'sch-nrlm', 1.0, 'seed'),

  ('SPMRM', 'scheme', 'sch-shyama-prasad-mukherji-rurban', 1.0, 'seed'),
  ('Rurban Mission', 'scheme', 'sch-shyama-prasad-mukherji-rurban', 1.0, 'seed'),

  ('RGSA', 'scheme', 'sch-rgsa', 1.0, 'seed'),
  ('Rashtriya Gram Swaraj Abhiyan (RGSA)', 'scheme', 'sch-rgsa', 1.0, 'seed'),

  ('PMMSY', 'scheme', 'sch-pmmsy', 1.0, 'seed'),
  ('Matsya Sampada Yojana', 'scheme', 'sch-pmmsy', 1.0, 'seed'),

  ('NLM', 'scheme', 'sch-national-livestock-mission', 1.0, 'seed'),
  ('NLM Scheme', 'scheme', 'sch-national-livestock-mission', 1.0, 'seed'),

  ('NFSA Food Subsidy', 'scheme', 'sch-nfsa-food-subsidy', 1.0, 'seed'),
  ('Food Subsidy Scheme', 'scheme', 'sch-nfsa-food-subsidy', 1.0, 'seed'),

  ('PM-GKAY', 'scheme', 'sch-pmgkay', 1.0, 'seed'),
  ('Garib Kalyan Anna Yojana', 'scheme', 'sch-pmgkay', 1.0, 'seed'),

  ('Agnipath', 'scheme', 'sch-agnipath', 1.0, 'seed'),
  ('Agnipath Yojana', 'scheme', 'sch-agnipath', 1.0, 'seed'),

  ('VVP', 'scheme', 'sch-vibrant-villages-programme', 1.0, 'seed'),
  ('Vibrant Villages Scheme', 'scheme', 'sch-vibrant-villages-programme', 1.0, 'seed'),

  ('MPF Scheme', 'scheme', 'sch-modernisation-police-forces', 1.0, 'seed'),
  ('Police Modernisation Scheme', 'scheme', 'sch-modernisation-police-forces', 1.0, 'seed'),

  ('NHM', 'scheme', 'sch-nhm', 1.0, 'seed'),
  ('National Health Mission Scheme', 'scheme', 'sch-nhm', 1.0, 'seed'),

  ('PM-JAY', 'scheme', 'sch-pmjay', 1.0, 'seed'),
  ('Ayushman Bharat', 'scheme', 'sch-pmjay', 1.0, 'seed'),
  ('AB-PMJAY', 'scheme', 'sch-pmjay', 1.0, 'seed'),

  ('PM-ABHIM', 'scheme', 'sch-pm-abhim', 1.0, 'seed'),
  ('Ayushman Bharat Health Infrastructure Mission', 'scheme', 'sch-pm-abhim', 1.0, 'seed'),

  ('Samagra Shiksha Abhiyan', 'scheme', 'sch-samagra-shiksha', 1.0, 'seed'),
  ('SSA (Samagra Shiksha)', 'scheme', 'sch-samagra-shiksha', 1.0, 'seed'),

  ('Mid Day Meal Scheme', 'scheme', 'sch-pm-poshan', 1.0, 'seed'),
  ('MDM Scheme', 'scheme', 'sch-pm-poshan', 1.0, 'seed'),
  ('PM POSHAN Scheme', 'scheme', 'sch-pm-poshan', 1.0, 'seed'),

  ('PM SHRI Schools', 'scheme', 'sch-pm-shri', 1.0, 'seed'),
  ('PM Schools for Rising India', 'scheme', 'sch-pm-shri', 1.0, 'seed'),

  ('PM-USHA', 'scheme', 'sch-pm-usha', 1.0, 'seed'),
  ('RUSA', 'scheme', 'sch-pm-usha', 1.0, 'seed'),

  ('Vidyalaxmi Scheme', 'scheme', 'sch-pm-vidyalaxmi', 1.0, 'seed'),
  ('PM Vidya Lakshmi', 'scheme', 'sch-pm-vidyalaxmi', 1.0, 'seed'),

  ('Poshan 2.0', 'scheme', 'sch-saksham-anganwadi-poshan2', 1.0, 'seed'),
  ('Anganwadi Services (Saksham)', 'scheme', 'sch-saksham-anganwadi-poshan2', 1.0, 'seed'),

  ('BBBP', 'scheme', 'sch-beti-bachao-beti-padhao', 1.0, 'seed'),
  ('Beti Bachao Beti Padhao Scheme', 'scheme', 'sch-beti-bachao-beti-padhao', 1.0, 'seed'),

  ('Mission Shakti Scheme', 'scheme', 'sch-mission-shakti', 1.0, 'seed'),
  ('Mission Shakti Yojana', 'scheme', 'sch-mission-shakti', 1.0, 'seed'),

  ('Vatsalya Scheme', 'scheme', 'sch-mission-vatsalya', 1.0, 'seed'),
  ('Mission Vatsalya Yojana', 'scheme', 'sch-mission-vatsalya', 1.0, 'seed'),

  ('PM-AJAY', 'scheme', 'sch-pm-ajay', 1.0, 'seed'),
  ('Pradhan Mantri Anusuchit Jaati Abhyuday Yojana', 'scheme', 'sch-pm-ajay', 1.0, 'seed'),

  ('PMS-SC', 'scheme', 'sch-post-matric-scholarship-sc', 1.0, 'seed'),
  ('Post Matric Scholarship (SC)', 'scheme', 'sch-post-matric-scholarship-sc', 1.0, 'seed'),

  ('PM-JANMAN', 'scheme', 'sch-pm-janman', 1.0, 'seed'),
  ('PVTG Mission', 'scheme', 'sch-pm-janman', 1.0, 'seed'),

  ('EMRS', 'scheme', 'sch-eklavya-model-schools', 1.0, 'seed'),
  ('Eklavya Model Residential School Scheme', 'scheme', 'sch-eklavya-model-schools', 1.0, 'seed'),

  ('PM VIKAS', 'scheme', 'sch-pm-vikas', 1.0, 'seed'),
  ('Pradhan Mantri Virasat Ka Samvardhan Yojana', 'scheme', 'sch-pm-vikas', 1.0, 'seed'),

  ('ELI Scheme', 'scheme', 'sch-eli-scheme', 1.0, 'seed'),
  ('Employment Linked Incentive', 'scheme', 'sch-eli-scheme', 1.0, 'seed'),

  ('APY', 'scheme', 'sch-atal-pension-yojana', 1.0, 'seed'),
  ('APY Pension Scheme', 'scheme', 'sch-atal-pension-yojana', 1.0, 'seed'),

  ('PM-SYM', 'scheme', 'sch-pmsym', 1.0, 'seed'),
  ('Shram Yogi Maandhan', 'scheme', 'sch-pmsym', 1.0, 'seed'),

  ('NAM', 'scheme', 'sch-national-ayush-mission', 1.0, 'seed'),
  ('NAM Scheme', 'scheme', 'sch-national-ayush-mission', 1.0, 'seed'),

  ('PMKVY', 'scheme', 'sch-pmkvy', 1.0, 'seed'),
  ('Kaushal Vikas Yojana', 'scheme', 'sch-pmkvy', 1.0, 'seed'),

  ('Khelo India Scheme', 'scheme', 'sch-khelo-india', 1.0, 'seed'),
  ('Khelo India Programme', 'scheme', 'sch-khelo-india', 1.0, 'seed'),

  ('Bharatmala', 'scheme', 'sch-bharatmala-pariyojana', 1.0, 'seed'),
  ('Bharatmala Scheme', 'scheme', 'sch-bharatmala-pariyojana', 1.0, 'seed'),

  ('PMAY-U', 'scheme', 'sch-pmay-urban', 1.0, 'seed'),
  ('PMAY(U)', 'scheme', 'sch-pmay-urban', 1.0, 'seed'),

  ('AMRUT', 'scheme', 'sch-amrut', 1.0, 'seed'),
  ('AMRUT 2.0', 'scheme', 'sch-amrut', 1.0, 'seed'),

  ('SCM', 'scheme', 'sch-smart-cities-mission', 1.0, 'seed'),
  ('Smart City Mission', 'scheme', 'sch-smart-cities-mission', 1.0, 'seed'),

  ('PMKSY', 'scheme', 'sch-pmksy', 1.0, 'seed'),
  ('Per Drop More Crop', 'scheme', 'sch-pmksy', 1.0, 'seed'),

  ('Namami Gange', 'scheme', 'sch-namami-gange', 1.0, 'seed'),
  ('NMCG', 'scheme', 'sch-namami-gange', 1.0, 'seed'),

  ('JJM', 'scheme', 'sch-jal-jeevan-mission', 1.0, 'seed'),
  ('Har Ghar Jal', 'scheme', 'sch-jal-jeevan-mission', 1.0, 'seed'),

  ('SBM-G', 'scheme', 'sch-swachh-bharat-mission-gramin', 1.0, 'seed'),
  ('SBM(G)', 'scheme', 'sch-swachh-bharat-mission-gramin', 1.0, 'seed'),

  ('BharatNet Programme', 'scheme', 'sch-bharatnet', 1.0, 'seed'),
  ('National Optical Fibre Network (BharatNet)', 'scheme', 'sch-bharatnet', 1.0, 'seed'),

  ('RDSS', 'scheme', 'sch-revamped-distribution-sector-scheme', 1.0, 'seed'),
  ('Revamped Distribution Sector Scheme (RDSS)', 'scheme', 'sch-revamped-distribution-sector-scheme', 1.0, 'seed'),

  ('PM Surya Ghar Yojana', 'scheme', 'sch-pm-surya-ghar', 1.0, 'seed'),
  ('Rooftop Solar Scheme', 'scheme', 'sch-pm-surya-ghar', 1.0, 'seed'),

  ('NGHM', 'scheme', 'sch-national-green-hydrogen-mission', 1.0, 'seed'),
  ('Green Hydrogen Mission', 'scheme', 'sch-national-green-hydrogen-mission', 1.0, 'seed'),

  ('Ujjwala Yojana', 'scheme', 'sch-pmuy', 1.0, 'seed'),
  ('PMUY', 'scheme', 'sch-pmuy', 1.0, 'seed'),

  ('RoDTEP Scheme', 'scheme', 'sch-rodtep', 1.0, 'seed'),
  ('RoDTEP Yojana', 'scheme', 'sch-rodtep', 1.0, 'seed'),

  ('PLI', 'scheme', 'sch-pli-scheme', 1.0, 'seed'),
  ('Production Linked Incentive', 'scheme', 'sch-pli-scheme', 1.0, 'seed'),

  ('SISFS', 'scheme', 'sch-startup-india-seed-fund', 1.0, 'seed'),
  ('Startup India Seed Fund', 'scheme', 'sch-startup-india-seed-fund', 1.0, 'seed'),

  ('PMEGP', 'scheme', 'sch-pmegp', 1.0, 'seed'),
  ('PM Employment Generation Programme', 'scheme', 'sch-pmegp', 1.0, 'seed'),

  ('CGTMSE Scheme', 'scheme', 'sch-cgtmse', 1.0, 'seed'),
  ('Credit Guarantee Fund Scheme', 'scheme', 'sch-cgtmse', 1.0, 'seed'),

  ('PM MITRA Parks', 'scheme', 'sch-pm-mitra', 1.0, 'seed'),
  ('PM MITRA Scheme', 'scheme', 'sch-pm-mitra', 1.0, 'seed'),

  ('Digital India', 'scheme', 'sch-digital-india', 1.0, 'seed'),
  ('Digital India Mission', 'scheme', 'sch-digital-india', 1.0, 'seed'),

  ('Semicon India', 'scheme', 'sch-semicon-india-programme', 1.0, 'seed'),
  ('Semiconductor Mission (Semicon India)', 'scheme', 'sch-semicon-india-programme', 1.0, 'seed'),

  ('Gaganyaan Programme', 'scheme', 'sch-gaganyaan', 1.0, 'seed'),
  ('Gaganyaan', 'scheme', 'sch-gaganyaan', 1.0, 'seed'),

  ('ANRF', 'scheme', 'sch-anusandhan-nrf', 1.0, 'seed'),
  ('National Research Foundation', 'scheme', 'sch-anusandhan-nrf', 1.0, 'seed'),

  ('BRIS', 'scheme', 'sch-biotech-research-innovation', 1.0, 'seed'),
  ('Biotechnology Research Innovation Scheme', 'scheme', 'sch-biotech-research-innovation', 1.0, 'seed'),

  ('Green India Mission', 'scheme', 'sch-national-mission-green-india', 1.0, 'seed'),
  ('GIM', 'scheme', 'sch-national-mission-green-india', 1.0, 'seed'),

  ('Culture Promotion Scheme', 'scheme', 'sch-scheme-promotion-culture', 1.0, 'seed'),
  ('Scheme for Promotion of Culture (Ministry of Culture)', 'scheme', 'sch-scheme-promotion-culture', 1.0, 'seed'),

  ('Swadesh Darshan Scheme', 'scheme', 'sch-swadesh-darshan', 1.0, 'seed'),
  ('Swadesh Darshan Yojana', 'scheme', 'sch-swadesh-darshan', 1.0, 'seed'),

  ('PRASHAD Yojana', 'scheme', 'sch-prashad', 1.0, 'seed'),
  ('PRASHAD Scheme', 'scheme', 'sch-prashad', 1.0, 'seed'),

  ('MPLAD Scheme', 'scheme', 'sch-mplads', 1.0, 'seed'),
  ('MP-LADS', 'scheme', 'sch-mplads', 1.0, 'seed'),

  ('PM-DevINE', 'scheme', 'sch-pm-devine', 1.0, 'seed'),
  ('PM''s DevINE Scheme', 'scheme', 'sch-pm-devine', 1.0, 'seed'),

  ('ECLGS', 'scheme', 'sch-emergency-credit-line-guarantee', 1.0, 'seed'),
  ('ECLGS Scheme', 'scheme', 'sch-emergency-credit-line-guarantee', 1.0, 'seed'),

  ('Jan Dhan Yojana', 'scheme', 'sch-pmjdy', 1.0, 'seed'),
  ('PMJDY', 'scheme', 'sch-pmjdy', 1.0, 'seed'),

  ('PMJJBY', 'scheme', 'sch-pmjjby', 1.0, 'seed'),
  ('Jeevan Jyoti Bima Yojana', 'scheme', 'sch-pmjjby', 1.0, 'seed'),

  ('PMSBY', 'scheme', 'sch-pmsby', 1.0, 'seed'),
  ('Suraksha Bima Yojana', 'scheme', 'sch-pmsby', 1.0, 'seed'),

  ('Stand Up India Scheme', 'scheme', 'sch-stand-up-india', 1.0, 'seed'),
  ('Stand-Up India Scheme', 'scheme', 'sch-stand-up-india', 1.0, 'seed'),

  ('MUDRA Yojana', 'scheme', 'sch-mudra-yojana', 1.0, 'seed'),
  ('PMMY', 'scheme', 'sch-mudra-yojana', 1.0, 'seed')

ON CONFLICT (alias, entity_type) DO NOTHING;
