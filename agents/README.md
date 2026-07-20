# Agent layer

Six agents sit on top of the canonical store (docs/05). They add explanation,
resolution and narrative. They add no figures.

## The hard rule

**Agents never write fiscal facts.**

They may write to exactly seven places:

| Table | Written by | What |
|---|---|---|
| `anomaly_flag` | A3 | Flags, always `status='pending'` |
| `anomaly_flag_evidence` | A3 | Links a flag to evidence it cites |
| `verification_report` | A4 | Narrative, citations, self-check outcome |
| `entity_alias` | A2 | Alias mappings at confidence >= 0.9 |
| `alias_review_queue` | A2 | Everything below that |
| `evidence_item.summary` | A4 | Two descriptive sentences, that column only |
| `agent_call` | all | One row per model call |

Everything else, `fiscal_fact` above all, is refused.

This is enforced, not documented. `agents/lib/db.py` wraps every connection in a
`GuardedConnection` whose cursors parse each statement for its write targets and
check them against an **allowlist**. A table added to the schema next month is
forbidden by default rather than permitted by oversight. `evidence_item` is
narrower still: only `UPDATE ... SET summary`, because the row itself carries a
`source_record_id` and belongs to ingestion.

Three tests hold the line, in `agents/tests/test_no_fiscal_writes.py`:

1. the guard refuses a write to `fiscal_fact` however it is phrased (qualified,
   quoted, inside a CTE, as a `MERGE`, as `TRUNCATE`);
2. the guard refuses tables nobody has thought about, because it is an allowlist;
3. every SQL string constant shipped in `agents/` is fed through the guard, so a
   forbidden statement cannot be added to the package without a failing test.

In production, run the agent processes under a database role whose grants match
the allowlist. The guard is what makes a mistake fail loudly in development,
where there is usually one superuser role and a hurry.

## The agents

| Agent | Trigger | Model call | Writes |
|---|---|---|---|
| **A1** extraction assist | Deterministic PDF parser reports low confidence | Standard, per page | Nothing. Returns candidates for a human |
| **A2** entity resolution | Unseen ministry, scheme or org string | Standard, only for ambiguous cases | `entity_alias` or `alias_review_queue` |
| **A3** anomaly | Post-pipeline, per fiscal year | Standard, only to write prose | `anomaly_flag` (pending) |
| **A4** verification | On demand, plus a weekly batch | Narrative model, plus a fast self-check call | `verification_report` |
| **A5** drift sentinel | Every pipeline run | None | Nothing. Pause register only |
| **A6** digest | Daily | None | Nothing |

### A1, extraction assist

The deterministic parser goes first; the model is the fallback; a human is the
final gate. The model transcribes what the page **printed**, including the unit
as labelled, and conversion to INR crore happens afterwards through the same
`pipelines.parsers.inr_amounts` parser the pipelines use. A page whose unit is
unstated produces a review item, never a number: crore and lakh differ by a
factor of a hundred.

```python
from agents.a1_extraction_assist import ExtractionAssistAgent, PageInput
outcome = ExtractionAssistAgent(client).run(PageInput(...))
outcome.usable        # convertible and confidently read
outcome.needs_review  # everything else, for the admin queue
```

A1 has no database write path at all. It does not even take a connection.

### A2, entity resolution

A ladder, cheapest first: exact match on the normalised name, then a dominant
trigram match in SQL, then model adjudication for the genuinely ambiguous
middle. Anything ending below **0.9** confidence goes to `alias_review_queue`.
An id the model names that was not on the candidate shortlist is treated as a
non-answer and queued.

### A3, anomaly

Rules are deterministic SQL and Python. The model writes the sentence and has no
vote on whether the flag exists. Thresholds live once, in
`agents/a3_anomaly/rules.py`:

| Rule | Fires when | Severity |
|---|---|---|
| `march_rush` | > 30 percent of the year's spend in Q4, or > 15 percent in March (complete years only) | notable / high |
| `under_utilization` | burn ratio < 0.5 with more than half the year elapsed | notable / high |
| `over_burn` | burn ratio > 1.3 | notable / high |
| `revision_swing` | \|RE − BE\| / BE > 25 percent | notable / high |
| `spend_no_tender` | capital-heavy entity, releases above 100 crore, zero central-portal tenders in 90 days | info only |
| `stat_outlier` | monthly z-score >= 2.5 against the same month across >= 3 prior years | notable / high |

If the model call fails, or returns a figure the rule did not measure, or uses
vocabulary docs/08 bans, the flag is still written with a deterministic
explanation assembled from the rule itself. A flag is a measurement; losing one
because a language model had a bad minute would be the wrong trade.

### A4, verification

The pipeline from docs/05 A4, including step 5. Facts are gathered into a closed
`FactBundle`; **derived figures are computed in Python and handed over as facts**
so the model never calculates anything; the narrative is composed; then two
self-check passes run and both must succeed:

* a deterministic pass that extracts every quantity from the markdown and
  matches it against the bundle's allowed values, and
* a second model call that reads for what a regular expression cannot see, such
  as a `RELEASE` figure described as expenditure.

On failure the narrative is regenerated **once**, with the specific problems fed
back. On a second failure the report falls back to a mechanical rendering of the
raw facts, `is_fallback = true`, and `self_check_passed = false` is recorded
either way so docs/09 can alert on the rate.

Live web search is **off by default** (`AGENT_ENABLE_WEB_SEARCH`). When on, the
server-side tool carries a domain allowlist so the restriction is enforced before
the model reads anything, and results are filtered again on the way back.

### A5, drift sentinel

Reuses `pipelines.lib.drift.sanity_check` rather than defining drift a second
time. On a high-severity finding it pauses the source's **canonical** writes and
alerts; staging keeps ingesting, so nothing is lost and a fixed parser can
reprocess the backlog. Resuming is manual.

The pause register is a JSON file under `AGENT_STATE_DIR` because this package
does not own the schema. When a column lands in `db/migrations`, `PauseStore` is
the seam to reimplement.

### A6, digest

Pure assembly from approved flags and existing evidence summaries. It makes no
model call, which is the most reliable way to make no new claims.

## Running them

```bash
uv sync
uv run pytest agents/tests -q            # no network, no API key, no database
uv run python -m agents.evals.runner     # golden-set evals, replay mode
```

The agents themselves are libraries, invoked from the pipeline schedule or the
API. A minimal harness:

```python
from agents.lib import AgentClient, DatabaseCallLogger, connect
from agents.a3_anomaly import AnomalyAgent

with connect() as conn:
    client = AgentClient(call_logger=DatabaseCallLogger(conn))
    AnomalyAgent(client, conn).run("FY2026")
```

`AgentClient` requires a `call_logger`; the default only logs to stdout and warns
that the call was not persisted, because a call that leaves no `agent_call` row
is a call the weekly cost and quality review cannot see.

## Cost profile

Model selection follows docs/05: Sonnet for volume work, Opus for narratives,
Haiku for the mechanical self check. Set via `AGENT_MODEL_FAST`,
`AGENT_MODEL_STANDARD` and `AGENT_MODEL_NARRATIVE`.

| Agent | Model | Calls | Notes |
|---|---|---|---|
| A1 | standard | 1 per low-confidence page, plus 1 on a validation retry | Vision, so input tokens dominate. Only fires where the deterministic parser gave up |
| A2 | standard | 1 per *ambiguous* name | Exact and dominant-trigram matches cost nothing. The rate falls as `entity_alias` fills up |
| A3 | standard | 1 per flag | Bounded by the flag count, not the entity count. Most entities produce none |
| A4 | narrative + fast | 2 on the happy path, 4 in the worst case, 0 on a cache hit | The most expensive agent. Cache reports and batch the top 50 schemes weekly |
| A5 | none | 0 | Arithmetic |
| A6 | none | 0 | Assembly |

Controls: A4 is the one to watch. It runs on demand with caching, the self check
uses the fast model deliberately, and the fallback path costs less than a
successful one rather than more. `agent_call` carries tokens and latency per
call, so the weekly review is a single query over one table.

## Prompts

`agents/prompts/*.md`. `prompt_version` is `<name>@<first 12 hex of the file's
SHA-256>`, so a version can never drift from the prompt it names: changing the
text changes the version, and that is the only way to change it.

Every prompt is validated on load and must instruct the model to state
"no evidence found" rather than infer, and must forbid the accusatory vocabulary
docs/08 section 2 bans. A prompt missing either fails at load, not in front of a
reader. Generated text is checked for that vocabulary again before anything is
written.

## Evals

`agents/evals/` holds the golden sets: extraction pages for A1, alias pairs for
A2, narratives for A4. They are synthetic, labelled as fixtures in every file,
and none of it is ingestible. Replay mode runs in CI with no API key and covers
every deterministic path: unit conversion, confidence routing, ladder
thresholds, and the number check. Run them on every prompt change.
