-- 0008: one place to resolve a source_record_id into everything the provenance
-- popover shows.
--
-- The popover is the affordance behind every number on the site, so it is a hot
-- path and it must never be the reason a figure ships without its evidence.
-- Resolving it through a single view keeps the API from assembling provenance
-- differently on each page.

CREATE VIEW v_provenance AS
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
  -- A single artifact is parsed by one method in practice. Where a document
  -- yielded facts by more than one route, the most common one is reported and
  -- the popover stays honest by also linking the raw artifact.
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
  ), FALSE) AS is_provisional
FROM source_record sr
JOIN source_registry reg ON reg.source_id = sr.source_id;
