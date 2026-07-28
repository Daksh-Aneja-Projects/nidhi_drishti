-- Demand bodies from the Union Budget's Statements of Budget Estimates.
--
-- Generated from indiabudget.gov.in/doc/eb/allsbe.xlsx, which is the
-- authority on which bodies receive a grant. Seeded rather than hand
-- written so the roster does not drift from the document it describes.
--
-- Central charges and constitutional bodies are deliberately absent:
-- interest payments, pensions, transfers to states, tax administration,
-- audit, and the President, Parliament and UPSC demands are not ministries.
-- They are the residual the national page already accounts for, and folding
-- them into the ministry breakdown would put fourteen lakh crore of
-- interest into a league table of departments.
--
-- Where the budget's spelling differs from a body already in the master, the
-- variant is aliased onto the existing id rather than minted as a second
-- ministry. "Environment, Forests and Climate Change" and "Environment, Forest
-- and Climate Change" are one ministry, and two rows would split its money.

INSERT INTO ministry (ministry_id, name) VALUES
  ('min-chemicals-and-petrochemicals', 'Department of Chemicals and Petrochemicals'),
  ('min-fertilisers', 'Department of Fertilisers'),
  ('min-pharmaceuticals', 'Department of Pharmaceuticals'),
  ('min-posts', 'Department of Posts'),
  ('min-public-enterprises', 'Department of Public Enterprises'),
  ('min-investment-and-public-asset-management-dipam', 'Department of Investment and Public Asset Management (DIPAM)'),
  ('min-parliamentary-affairs', 'Ministry of Parliamentary Affairs'),
  ('min-planning', 'Ministry of Planning'),
  ('min-ports-shipping-and-waterways', 'Ministry of Ports, Shipping and Waterways'),
  ('min-scientific-and-industrial-research', 'Department of Scientific and Industrial Research')
ON CONFLICT (ministry_id) DO NOTHING;

INSERT INTO entity_alias (alias, entity_type, entity_id, source_id, resolved_by) VALUES
  ('Department of Agricultural Research and Education', 'ministry', 'min-agriculture', 'union_budget', 'seed'),
  ('Atomic Energy', 'ministry', 'min-atomic-energy', 'union_budget', 'seed'),
  ('Department of Chemicals and Petrochemicals', 'ministry', 'min-chemicals-and-petrochemicals', 'union_budget', 'seed'),
  ('Department of Fertilisers', 'ministry', 'min-fertilisers', 'union_budget', 'seed'),
  ('Department of Pharmaceuticals', 'ministry', 'min-pharmaceuticals', 'union_budget', 'seed'),
  ('Department of Posts', 'ministry', 'min-posts', 'union_budget', 'seed'),
  ('Ministry of Defence (Civil)', 'ministry', 'min-defence', 'union_budget', 'seed'),
  ('Defence Services (Revenue)', 'ministry', 'min-defence', 'union_budget', 'seed'),
  ('Capital Outlay on Defence Services', 'ministry', 'min-defence', 'union_budget', 'seed'),
  ('Defence Pensions', 'ministry', 'min-defence', 'union_budget', 'seed'),
  ('Ministry of Environment, Forests and Climate Change', 'ministry', 'min-environment-forest-climate-change', 'union_budget', 'seed'),
  ('Department of Public Enterprises', 'ministry', 'min-public-enterprises', 'union_budget', 'seed'),
  ('Department of Investment and Public Asset Management (DIPAM)', 'ministry', 'min-investment-and-public-asset-management-dipam', 'union_budget', 'seed'),
  ('Cabinet', 'ministry', 'min-home-affairs', 'union_budget', 'seed'),
  ('Police', 'ministry', 'min-home-affairs', 'union_budget', 'seed'),
  ('Ministry of Home Affairs (Andaman and Nicobar Islands)', 'ministry', 'min-home-affairs', 'union_budget', 'seed'),
  ('Ministry of Home Affairs (Chandigarh)', 'ministry', 'min-home-affairs', 'union_budget', 'seed'),
  ('Ministry of Home Affairs (Dadra and Nagar Haveli and Daman and Diu)', 'ministry', 'min-home-affairs', 'union_budget', 'seed'),
  ('Ministry of Home Affairs (Ladakh)', 'ministry', 'min-home-affairs', 'union_budget', 'seed'),
  ('Ministry of Home Affairs (Lakshadweep)', 'ministry', 'min-home-affairs', 'union_budget', 'seed'),
  ('Transfers to Delhi', 'ministry', 'min-home-affairs', 'union_budget', 'seed'),
  ('Transfers to Jammu and Kashmir', 'ministry', 'min-home-affairs', 'union_budget', 'seed'),
  ('Transfers to Puducherry', 'ministry', 'min-home-affairs', 'union_budget', 'seed'),
  ('Law and Justice', 'ministry', 'min-law-justice', 'union_budget', 'seed'),
  ('Election Commission', 'ministry', 'min-law-justice', 'union_budget', 'seed'),
  ('Supreme Court of India', 'ministry', 'min-law-justice', 'union_budget', 'seed'),
  ('Ministry of Parliamentary Affairs', 'ministry', 'min-parliamentary-affairs', 'union_budget', 'seed'),
  ('Central Vigilance Commission', 'ministry', 'min-personnel-public-grievances-pensions', 'union_budget', 'seed'),
  ('Ministry of Planning', 'ministry', 'min-planning', 'union_budget', 'seed'),
  ('Ministry of Ports, Shipping and Waterways', 'ministry', 'min-ports-shipping-and-waterways', 'union_budget', 'seed'),
  ('Department of Land Resources', 'ministry', 'min-rural-development', 'union_budget', 'seed'),
  ('Department of Scientific and Industrial Research', 'ministry', 'min-scientific-and-industrial-research', 'union_budget', 'seed'),
  ('Department of Social Justice and Empowerment', 'ministry', 'min-social-justice-empowerment', 'union_budget', 'seed'),
  ('Department of Empowerment of Persons with Disabilities', 'ministry', 'min-social-justice-empowerment', 'union_budget', 'seed')
ON CONFLICT (alias, entity_type) DO NOTHING;
