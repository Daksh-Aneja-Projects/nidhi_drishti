-- 0013: record a spreadsheet parse as what it is.
--
-- The Union Budget publishes its Statements of Budget Estimates as an xlsx and
-- the CGA its monthly accounts as an xlsm, so the most important figures on the
-- site now arrive from a spreadsheet. The existing options forced that to be
-- labelled `csv_parse`, which is close but not true, or `pdf_table`, which is
-- false.
--
-- This matters because extraction_method is published: it appears in the
-- provenance popover under every figure, and a reader deciding how much to
-- trust a number is entitled to know whether it was read from the publisher's
-- own spreadsheet cell or recovered from a PDF table with no ruling lines.
-- Those carry genuinely different confidence and should not share a label.

ALTER TABLE fiscal_fact DROP CONSTRAINT IF EXISTS fiscal_fact_extraction_method_check;

ALTER TABLE fiscal_fact ADD CONSTRAINT fiscal_fact_extraction_method_check
  CHECK (extraction_method IN
    ('structured_api','csv_parse','spreadsheet','html_table','pdf_table','pdf_text',
     'agent_assisted','manual_entry','illustrative'));
