-- Central schemes (docs/03 tier 3 reference data), linked to the ministries
-- and departments seeded in 03_ministries.sql. Names and ministry ownership
-- only, no rupee figures: allocation, release and utilization amounts belong
-- exclusively to fiscal_fact and must always trace to a source_record
-- (CLAUDE.md principle 1).
--
-- scheme_type: 'CSS' (Centrally Sponsored Scheme, funding shared with and
-- implemented by states) vs 'CS' (Central Sector Scheme, wholly central).
-- Classification follows how each scheme is commonly described in budget and
-- ministry documents; individual schemes occasionally get reclassified
-- between Plan restructurings, so treat this as the working default rather
-- than a legal fact.

INSERT INTO scheme (scheme_id, ministry_id, name, scheme_type) VALUES
  -- Agriculture and rural
  ('sch-pm-kisan', 'min-agriculture', 'PM-KISAN (Pradhan Mantri Kisan Samman Nidhi)', 'CS'),
  ('sch-pmfby', 'min-agriculture', 'Pradhan Mantri Fasal Bima Yojana', 'CSS'),
  ('sch-pm-kisan-maandhan', 'min-agriculture', 'Pradhan Mantri Kisan Maandhan Yojana', 'CS'),
  ('sch-kcc-interest-subvention', 'min-agriculture', 'Modified Interest Subvention Scheme', 'CS'),
  ('sch-rkvy', 'min-agriculture', 'Rashtriya Krishi Vikas Yojana', 'CSS'),
  ('sch-namo-drone-didi', 'min-agriculture', 'Namo Drone Didi', 'CS'),
  ('sch-mgnrega', 'min-rural-development', 'Mahatma Gandhi National Rural Employment Guarantee Scheme', 'CSS'),
  ('sch-pmay-gramin', 'min-rural-development', 'Pradhan Mantri Awaas Yojana, Gramin', 'CSS'),
  ('sch-pmgsy', 'min-rural-development', 'Pradhan Mantri Gram Sadak Yojana', 'CSS'),
  ('sch-nrlm', 'min-rural-development', 'Deendayal Antyodaya Yojana, National Rural Livelihood Mission', 'CSS'),
  ('sch-shyama-prasad-mukherji-rurban', 'min-rural-development', 'Shyama Prasad Mukherji Rurban Mission', 'CSS'),
  ('sch-rgsa', 'min-panchayati-raj', 'Rashtriya Gram Swaraj Abhiyan', 'CSS'),
  ('sch-pmmsy', 'min-fisheries-animal-husbandry-dairying', 'Pradhan Mantri Matsya Sampada Yojana', 'CSS'),
  ('sch-national-livestock-mission', 'min-fisheries-animal-husbandry-dairying', 'National Livestock Mission', 'CSS'),
  ('sch-nfsa-food-subsidy', 'min-consumer-affairs-food-pds', 'Food Subsidy under the National Food Security Act', 'CS'),
  ('sch-pmgkay', 'min-consumer-affairs-food-pds', 'Pradhan Mantri Garib Kalyan Anna Yojana', 'CS'),

  -- Defence and security
  ('sch-agnipath', 'min-defence', 'Agnipath Scheme', 'CS'),
  ('sch-vibrant-villages-programme', 'min-home-affairs', 'Vibrant Villages Programme', 'CS'),
  ('sch-modernisation-police-forces', 'min-home-affairs', 'Scheme for Modernisation of Police Forces', 'CSS'),

  -- Social sector
  ('sch-nhm', 'min-health-family-welfare', 'National Health Mission', 'CSS'),
  ('sch-pmjay', 'min-health-family-welfare', 'Ayushman Bharat, Pradhan Mantri Jan Arogya Yojana', 'CSS'),
  ('sch-pm-abhim', 'min-health-family-welfare', 'Pradhan Mantri Ayushman Bharat Health Infrastructure Mission', 'CSS'),
  ('sch-samagra-shiksha', 'min-education-school', 'Samagra Shiksha', 'CSS'),
  ('sch-pm-poshan', 'min-education-school', 'PM POSHAN (erstwhile Mid Day Meal Scheme)', 'CSS'),
  ('sch-pm-shri', 'min-education-school', 'PM Schools for Rising India (PM SHRI)', 'CSS'),
  ('sch-pm-usha', 'min-education-higher', 'PM Uchchatar Shiksha Abhiyan', 'CSS'),
  ('sch-pm-vidyalaxmi', 'min-education-higher', 'PM Vidyalaxmi', 'CS'),
  ('sch-saksham-anganwadi-poshan2', 'min-women-child-development', 'Saksham Anganwadi and Poshan 2.0', 'CSS'),
  ('sch-beti-bachao-beti-padhao', 'min-women-child-development', 'Beti Bachao Beti Padhao', 'CSS'),
  ('sch-mission-shakti', 'min-women-child-development', 'Mission Shakti', 'CSS'),
  ('sch-mission-vatsalya', 'min-women-child-development', 'Mission Vatsalya', 'CSS'),
  ('sch-pm-ajay', 'min-social-justice-empowerment', 'Pradhan Mantri Anusuchit Jaati Abhyuday Yojana (PM-AJAY)', 'CSS'),
  ('sch-post-matric-scholarship-sc', 'min-social-justice-empowerment', 'Post Matric Scholarship for Scheduled Caste Students', 'CSS'),
  ('sch-pm-janman', 'min-tribal-affairs', 'Pradhan Mantri Janjati Adivasi Nyaya Maha Abhiyan (PM-JANMAN)', 'CS'),
  ('sch-eklavya-model-schools', 'min-tribal-affairs', 'Eklavya Model Residential Schools', 'CSS'),
  ('sch-pm-vikas', 'min-minority-affairs', 'Pradhan Mantri Virasat Ka Samvardhan (PM VIKAS)', 'CS'),
  ('sch-eli-scheme', 'min-labour-employment', 'Employment Linked Incentive Scheme', 'CS'),
  ('sch-atal-pension-yojana', 'min-labour-employment', 'Atal Pension Yojana', 'CS'),
  ('sch-pmsym', 'min-labour-employment', 'Pradhan Mantri Shram Yogi Maandhan', 'CS'),
  ('sch-national-ayush-mission', 'min-ayush', 'National AYUSH Mission', 'CSS'),
  ('sch-pmkvy', 'min-skill-development-entrepreneurship', 'Pradhan Mantri Kaushal Vikas Yojana', 'CS'),
  ('sch-khelo-india', 'min-youth-affairs-sports', 'Khelo India', 'CS'),

  -- Infrastructure
  ('sch-bharatmala-pariyojana', 'min-road-transport-highways', 'Bharatmala Pariyojana', 'CS'),
  ('sch-pmay-urban', 'min-housing-urban-affairs', 'Pradhan Mantri Awas Yojana, Urban', 'CSS'),
  ('sch-amrut', 'min-housing-urban-affairs', 'Atal Mission for Rejuvenation and Urban Transformation (AMRUT 2.0)', 'CSS'),
  ('sch-smart-cities-mission', 'min-housing-urban-affairs', 'Smart Cities Mission', 'CS'),
  ('sch-pmksy', 'min-jal-shakti-water-resources', 'Pradhan Mantri Krishi Sinchayee Yojana', 'CSS'),
  ('sch-namami-gange', 'min-jal-shakti-water-resources', 'Namami Gange Programme', 'CS'),
  ('sch-jal-jeevan-mission', 'min-jal-shakti-drinking-water-sanitation', 'Jal Jeevan Mission', 'CSS'),
  ('sch-swachh-bharat-mission-gramin', 'min-jal-shakti-drinking-water-sanitation', 'Swachh Bharat Mission, Grameen', 'CSS'),
  ('sch-bharatnet', 'min-communications-telecom', 'BharatNet', 'CS'),

  -- Energy
  ('sch-revamped-distribution-sector-scheme', 'min-power', 'Revamped Distribution Sector Scheme', 'CS'),
  ('sch-pm-surya-ghar', 'min-power', 'PM Surya Ghar Muft Bijli Yojana', 'CS'),
  ('sch-national-green-hydrogen-mission', 'min-new-renewable-energy', 'National Green Hydrogen Mission', 'CS'),
  ('sch-pmuy', 'min-petroleum-natural-gas', 'Pradhan Mantri Ujjwala Yojana', 'CS'),

  -- Industry and commerce
  ('sch-rodtep', 'min-commerce', 'Remission of Duties and Taxes on Exported Products (RoDTEP)', 'CS'),
  ('sch-pli-scheme', 'min-industry-internal-trade', 'Production Linked Incentive Scheme', 'CS'),
  ('sch-startup-india-seed-fund', 'min-industry-internal-trade', 'Startup India Seed Fund Scheme', 'CS'),
  ('sch-pmegp', 'min-msme', 'Prime Minister''s Employment Generation Programme', 'CS'),
  ('sch-cgtmse', 'min-msme', 'Credit Guarantee Scheme for Micro and Small Enterprises', 'CS'),
  ('sch-pm-mitra', 'min-textiles', 'PM Mega Integrated Textile Region and Apparel Parks (PM MITRA)', 'CS'),

  -- Science and technology
  ('sch-digital-india', 'min-electronics-it', 'Digital India Programme', 'CS'),
  ('sch-semicon-india-programme', 'min-electronics-it', 'Semicon India Programme', 'CS'),
  ('sch-gaganyaan', 'min-space', 'Gaganyaan Mission', 'CS'),
  ('sch-anusandhan-nrf', 'min-science-technology', 'Anusandhan National Research Foundation', 'CS'),
  ('sch-biotech-research-innovation', 'min-biotechnology', 'Biotechnology Research and Innovation Scheme', 'CS'),

  -- Environment
  ('sch-national-mission-green-india', 'min-environment-forest-climate-change', 'National Mission for a Green India', 'CSS'),

  -- Culture and tourism
  ('sch-scheme-promotion-culture', 'min-culture', 'Scheme for Promotion of Culture', 'CS'),
  ('sch-swadesh-darshan', 'min-tourism', 'Swadesh Darshan 2.0', 'CS'),
  ('sch-prashad', 'min-tourism', 'Pilgrimage Rejuvenation and Spiritual Augmentation Drive (PRASHAD)', 'CS'),

  -- Governance
  ('sch-mplads', 'min-statistics-programme-implementation', 'Member of Parliament Local Area Development Scheme', 'CS'),
  ('sch-pm-devine', 'min-doner', 'PM''s Development Initiative for North East Region (PM-DevINE)', 'CS'),

  -- Finance
  ('sch-emergency-credit-line-guarantee', 'min-economic-affairs', 'Emergency Credit Line Guarantee Scheme', 'CS'),
  ('sch-pmjdy', 'min-financial-services', 'Pradhan Mantri Jan Dhan Yojana', 'CS'),
  ('sch-pmjjby', 'min-financial-services', 'Pradhan Mantri Jeevan Jyoti Bima Yojana', 'CS'),
  ('sch-pmsby', 'min-financial-services', 'Pradhan Mantri Suraksha Bima Yojana', 'CS'),
  ('sch-stand-up-india', 'min-financial-services', 'Stand-Up India', 'CS'),
  ('sch-mudra-yojana', 'min-financial-services', 'Pradhan Mantri MUDRA Yojana', 'CS')

ON CONFLICT (scheme_id) DO UPDATE SET
  ministry_id = EXCLUDED.ministry_id,
  name        = EXCLUDED.name,
  scheme_type = EXCLUDED.scheme_type;
