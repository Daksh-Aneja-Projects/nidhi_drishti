# 05 — Agent Layer

Agents add intelligence on top of canonical data. Hard rule: **agents never write fiscal facts** — they write flags, reports, summaries, and alias suggestions. All agent output carries `model`, `prompt_version`, and citations.

## A1 — Extraction Assist Agent
- **Trigger**: parser confidence low / table extraction failed on a PDF page.
- **Does**: Claude with the page image + text → structured JSON per source schema; output re-validated by the same pydantic schema; low-confidence extractions go to a human-review queue (admin UI), not straight to staging.
- **Why**: Budget/CGA/parliament PDFs have merged cells and layout chaos; deterministic parsers first, LLM as fallback, human as final gate.

## A2 — Entity Resolution Agent
- **Trigger**: unseen ministry/scheme/org string (from tenders, PIB, PFMS).
- **Does**: candidate match against `entity_alias` (trigram + embedding similarity); LLM adjudicates ambiguous cases with reasoning; writes to `entity_alias` with confidence; <0.9 confidence → review queue.
- **Metric**: % of tender orgs auto-resolved; target >85% after month 2.

## A3 — Anomaly Detection (rules first, stats second, LLM last)
Deterministic rules (SQL, run post-pipeline):
- `march_rush`: >30% of FY spend in Q4, or >15% in March alone.
- `under_utilization`: burn_ratio < 0.5 with >50% FY elapsed.
- `over_burn`: burn_ratio > 1.3 (heading past authority).
- `spend_no_tender`: capital-heavy entity with releases up but zero CPPP activity in trailing 90d (Tier-2 signal — severity 'info' only).
- `revision_swing`: |RE − BE| / BE > 25%.
Statistical: per-entity monthly spend z-score vs same-month historical (needs ≥3 FYs of history — bootstrap from Open Budgets India + CGA archives).
LLM role: writes the plain-language `explanation` with citations from evidence_items; does NOT decide whether a flag exists.
**Human review**: all 'notable'/'high' flags require approval in admin UI before appearing publicly (first 6 months; revisit).

## A4 — Verification Agent (the "live page")
- **Trigger**: on-demand (user opens verification tab) with caching, + weekly batch for top-50 schemes.
- **Pipeline**:
  1. Pull fiscal facts for entity+FY (allocation, expenditure/releases).
  2. Retrieve evidence: tenders (SQL), PIB/news/parliament items (pgvector similarity + date filter).
  3. Optional live web search (Anthropic web-search tool) for the trailing 30 days, restricted to a domain allowlist (pib.gov.in, major business press, ministry domains).
  4. Claude composes `narrative_md`: released vs observable-activity comparison, every claim cited, explicit "no evidence found" statements allowed and encouraged.
  5. Self-check pass: a second model call verifies every number in the narrative exists in the provided facts (kills hallucinated figures). Failures regenerate once, then fall back to a template rendering of raw facts.
- **Output contract**: `verification_report` row; UI renders markdown with citation chips; banner: "AI-assembled from cited public sources — not an official reconciliation."

## A5 — Drift Sentinel
- **Trigger**: every pipeline run.
- **Does**: compares run metrics vs history (row counts, column sets, totals, parse-error rate); on drift → Telegram/Slack alert with artifact diff link; can auto-pause a source's canonical writes (staging still ingests).
- This agent is why the product stays trustworthy at month 18 when three portals have silently redesigned.

## A6 — Daily Digest (v1.1)
- Compiles approved flags + notable evidence into a daily email/RSS for subscribers. Pure assembly from approved content; no new claims.

## Prompt & eval discipline
- Prompts live in `/agents/prompts/*.md`, versioned; `prompt_version` recorded on every output.
- Golden-set evals in `/agents/evals/`: 20+ PDF pages for A1, 100 alias pairs for A2, 10 hand-checked narratives for A4. Run on every prompt change.
- Model: Claude Sonnet for A1/A2/A5 volume work; consider Opus-class for A4 narratives. Structured outputs (JSON schema) everywhere except narrative_md.
