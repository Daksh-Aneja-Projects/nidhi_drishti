-- 0012: record how an artifact was obtained, not just what it was.
--
-- Several Tier 1 sources refuse automated clients outright (docs/08 section 1
-- anticipates this and permits a manual periodic download instead). Documents
-- obtained that way are perfectly good evidence, but a reader deserves to know
-- which route produced the figure in front of them: an unattended pipeline that
-- will re-run tomorrow, or a named person who downloaded a PDF last Tuesday.
--
-- Defaulting to 'automated' is safe for the rows already here: every one of
-- them was written by a pipeline fetching a URL.

ALTER TABLE source_record
  ADD COLUMN retrieval_method TEXT NOT NULL DEFAULT 'automated'
    CHECK (retrieval_method IN ('automated', 'operator_download')),
  -- Who performed a manual download. Meaningless for an automated fetch, so it
  -- is required only for the other case.
  ADD COLUMN retrieved_by TEXT,
  ADD COLUMN retrieval_note TEXT,
  ADD CONSTRAINT source_record_operator_named CHECK (
    retrieval_method <> 'operator_download'
    OR (retrieved_by IS NOT NULL AND length(btrim(retrieved_by)) > 0)
  );

CREATE INDEX source_record_retrieval_idx
  ON source_record (retrieval_method, fetched_at DESC);

-- The popover resolves everything it shows through this view, so the new fields
-- have to arrive here or they may as well not exist.
CREATE OR REPLACE VIEW v_provenance AS
SELECT
  sr.source_record_id,
  sr.source_id,
  reg.name          AS source_name,
  reg.tier          AS source_tier,
  sr.url,
  sr.artifact_key,
  sr.artifact_sha256,
  sr.document_date,
  sr.fetched_at,
  (
    SELECT f.extraction_method
    FROM fiscal_fact f
    WHERE f.source_record_id = sr.source_record_id
    GROUP BY f.extraction_method
    ORDER BY COUNT(*) DESC
    LIMIT 1
  ) AS extraction_method,
  COALESCE((
    SELECT BOOL_OR(f.is_provisional)
    FROM fiscal_fact f
    WHERE f.source_record_id = sr.source_record_id
  ), FALSE) AS is_provisional,
  sr.retrieval_method,
  sr.retrieved_by,
  sr.retrieval_note
FROM source_record sr
JOIN source_registry reg ON reg.source_id = sr.source_id;
