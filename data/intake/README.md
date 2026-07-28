# Document intake

Some official sources cannot be read by an automated client. A few disallow it
in `robots.txt`, several sit behind a firewall that refuses any non-browser
request, and one or two publish figures that only exist after JavaScript has
run. We do not work around any of that. `docs/08-legal-compliance.md` fixes the
answer for those sources, and it is a manual periodic download.

This directory is where those downloads go. A file dropped here is ingested by
the ordinary pipeline: the same parser, the same schema validation, the same
drift checks, the same content-addressed copy of the original in object
storage. The only difference is in the provenance, and it is a difference the
site states out loud: figures from a hand-downloaded document are labelled as
obtained by an operator, with their name and the time they downloaded it.

## What this is not

It is not manual data entry. No amount is ever typed in here. The manifest
records where a document came from; the numbers still have to come out of the
document itself, through a parser, or they do not get published.

## Doing a drop

1. Open the portal in an ordinary browser and download the document, exactly as
   any member of the public would. Do not attempt to get past a login, a
   CAPTCHA or a block. If a document is not available to an anonymous visitor,
   it is not a document this project publishes from.

2. Put the file in the directory named after the source's registry id:

   ```
   data/intake/union_budget/sumsbe-2026-27.pdf
   ```

   The registry ids are the ones in `source_registry`, which are not always the
   pipeline names: `pfms_pub`, `ogd`, `pib`, `cppp`, `gem`, `jjm`.

3. Generate the manifest skeleton beside it:

   ```bash
   uv run python -m pipelines intake template data/intake/union_budget/sumsbe-2026-27.pdf
   ```

4. Fill it in. Two fields cannot be guessed and are required:

   ```json
   {
     "source_url": "https://www.indiabudget.gov.in/doc/eb/sumsbe.pdf",
     "retrieved_at": "2026-07-28T09:15:00+05:30",
     "retrieved_by": "A. Operator <ops@example.org>",
     "document_date": "2026-02-01",
     "title": "Expenditure Budget, summary of budget estimates",
     "content_type": null,
     "note": "Downloaded manually: the portal refuses automated requests."
   }
   ```

   `source_url` must be the document's own public URL, because it is published
   as the link a reader follows to check the figure themselves. `retrieved_by`
   names a person, because a manual step is only auditable if it does.

5. Check the drop before running anything:

   ```bash
   uv run python -m pipelines intake check union_budget
   ```

6. Ingest:

   ```bash
   uv run python -m pipelines run union_budget --from-intake
   ```

   Or one specific file:

   ```bash
   uv run python -m pipelines run union_budget --from-file data/intake/union_budget/sumsbe-2026-27.pdf
   ```

   Add `--dry-run` to parse and validate without writing anything, which is the
   right first move with a document the parser has not seen before.

## Rules the code enforces

- A document with no manifest is not ingested.
- `source_url` passes the same public-access test as an automated fetch. A
  login, SSO or CAPTCHA URL is refused here too.
- `retrieved_at` must carry a timezone and must not be in the future. It becomes
  the freshness shown on the site, so a wrong value makes stale data look new.
- An empty file is refused: an empty download is a failed download.
- A pipeline that asks for a document nobody downloaded fails loudly. It never
  quietly falls back to the network, because a run that is half manual and half
  automated leaves no way to tell which figure came from where.

The files themselves are not committed. The directory structure is.
