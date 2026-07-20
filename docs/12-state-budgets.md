# 12 — State Budgets (v2 data-source map)

> The v2 roadmap line. States and union territories become first-class fiscal
> entities alongside the Union. Read docs/04 first: state budgets reuse the
> canonical model unchanged, they do not fork it.

This document is to states what docs/03 is to the Union: the ground-truth source
map, plus the modelling rules that keep a state's rupee from being counted twice.

## 1. How a state budget fits the canonical model

A state budget is the same shape of data as a Union budget: an authority side
(Budget Estimate and Revised Estimate, with supplementary demands during the
year) and an actuals side (audited or provisional expenditure). State fiscal
years are April to March, identical to the Union, so every fy helper is reused
without change.

Two schema decisions (db/migrations/0011):

- **`entity_type` gains `state` and `state_department`**, rather than a parallel
  set of `state_fiscal_fact` tables. The reconciliation engine, the five fiscal
  stages, the provenance chain, revision supersession, the de-cumulation view
  and every invariant are already `entity_type` agnostic, so states inherit all
  of it for free. A parallel-tables design would fork each of those into a second
  copy that could drift from the first. The materialised summaries each filter by
  `entity_type`, so state rows never leak into a Union summary.
- **`source_registry.jurisdiction`** (`union` | `state`, default `union`) records
  which ledger a fact belongs to, from its provenance alone.

A state's headline figures live under `entity_type = 'state'`, `entity_id` a
stable slug such as `st-karnataka`. Department-level facts are supported under
`entity_type = 'state_department'` (`std-...`) for later ingestion; the initial
pipelines target the state aggregate, which is the verifiable figure.

## 2. The CSS double-counting rule (read this before adding a state)

A Centrally Sponsored Scheme (for example the National Health Mission, PMAY-G or
MGNREGA) is funded partly by the Centre and implemented by a state. The Centre
records its central share on the Union side, as a scheme RELEASE. That same money
then reappears inside the state's accounts as receipts and expenditure. **Adding
"Union scheme spend" to "state total spend" counts the central share twice**, once
when the Centre releases it and once when the state spends it.

The rule this product commits to:

1. The Union scheme ledger (`fiscal_fact` rows with `entity_type = 'scheme'`) is
   central share only. `mv_scheme_summary` sums exactly those rows.
2. A state's spending is recorded **only** under `entity_type in
   ('state','state_department')`. State scheme-level spending is never written
   under `entity_type = 'scheme'`, because `mv_scheme_summary` would then sum it
   on top of the Union central share for the same scheme.
3. The Union national total (`mv_national_summary`) and the state totals
   (`mv_state_summary`) are two distinct ledgers. They are presented side by side
   and are **never summed into one "Government of India" figure** without netting
   out central transfers to states. The product does not publish a naive
   Union + states grand total.

This is enforced, not just documented:

- The invariant **`state_source_in_union_ledger`** (error) fires the moment a fact
  ingested from a `jurisdiction = 'state'` source lands in the scheme, ministry or
  national ledger. That is the check that catches a CSS being counted in both a
  Union and a state total.
- The invariant **`state_fact_unknown_state`** (error) catches a state fact that
  points at an unseeded state id.
- `@nidhi/core` exports `LEDGER_SEPARATION_NOTICE`, the one-line explanation the
  UI shows wherever the two ledgers sit near each other.

What is deliberately **not** modelled yet: the split of a state's total into its
own resources versus central transfers received. States publish this in their
receipts tables, but our expenditure-authority fact model does not carry it, so
the state total is presented as the state itself presents it (own revenue plus
central transfers blended) and is simply never added to the Union total.

## 3. Per-state source map

Only the two states the v2 line ships are registered as sources. Every URL is
held in one constant per pipeline module and is **unverified**: a 404 or a moved
table raises a drift alert rather than writing a guess (docs/08 section 1).

### 3.1 Karnataka — `state_karnataka`

- **What**: Budget at a Glance and the detailed budget documents from the Finance
  Department. Karnataka has a relatively mature budget-transparency posture.
- **Homepage**: finance.karnataka.gov.in
- **Format**: HTML summary pages and PDF budget volumes. The pipeline parses the
  Budget at a Glance summary table (revenue and capital expenditure across the
  Accounts, Revised Estimate and Budget Estimate columns).
- **Access**: direct download, no authentication.
- **Stage mapping**: the Budget Estimate and Revised Estimate columns become BE
  and RE authority facts; the Accounts column becomes a full-year EXPENDITURE
  fact (April to March, cumulative).
- **Quirks**: figures are usually in rupees crore, stated in the caption; the unit
  is read from the document, never assumed. Column headers combine the year and
  the stage ("2025-26 Budget Estimates"). Some documents use a two-row header,
  which the current parser does not read; that surfaces as a drift alert.
- **Licence**: Government of Karnataka published documents, reusable under NDSAP
  with attribution to the Finance Department, Government of Karnataka.

### 3.2 Odisha — `state_odisha`

- **What**: Budget at a Glance and budget documents from the Finance Department;
  budget data is also mirrored on a dedicated Odisha Budget portal.
- **Homepage**: finance.odisha.gov.in (mirror: odishabudget.gov.in)
- **Format**: HTML and PDF. The pipeline parses the Budget at a Glance summary.
- **Stage mapping**: as Karnataka. Odisha frequently labels the completed year as
  "Provisional Actuals"; those become EXPENDITURE facts flagged provisional, so a
  later audited figure supersedes them cleanly.
- **Quirks**: Odisha splits expenditure into "Programme Expenditure" and
  "Administrative Expenditure" as well as the revenue/capital rows. Only the
  revenue, capital and total expenditure rows are read; the programme split is a
  known gap, not a silent guess.
- **Licence**: Government of Odisha published documents, reusable under NDSAP with
  attribution to the Finance Department, Government of Odisha.

### 3.3 Rajasthan and beyond (not yet shipped)

Rajasthan was named alongside Karnataka and Odisha as a state with relatively open
treasury data and is the natural third source. It is seeded in the `state` table
but has no pipeline yet. Adding it is the same shape of work: a registry row with
`jurisdiction = 'state'`, a module holding its URLs in one constant, a Budget at a
Glance parser tuned to its labels, and a fixture. No schema change is needed.

## 4. Reference data seeded

- All **28 states** and **8 union territories** are in the `state` table with a
  stable id (`st-karnataka`), a `kind` (`state` or `ut`), an editorial `region`,
  and `has_legislature`. The five union territories with no legislative assembly
  (Andaman and Nicobar, Chandigarh, Dadra and Nagar Haveli and Daman and Diu,
  Ladakh, Lakshadweep) are marked `has_legislature = false`; their expenditure
  runs through the Union budget rather than a budget of their own, so the UI
  should not imply a state treasury portal for them.
- Entity aliases for Karnataka and Odisha resolve "Government of Karnataka",
  "State of Karnataka", "Orissa" and similar variants onto the stable ids.

## 5. Honest limitations (surface these in the product)

State treasury data quality varies enormously, far more than the Union's. Be
specific about it:

1. **Coverage is aggregate, not scheme-level.** The initial pipelines read the
   Budget at a Glance summary: total, revenue and capital expenditure. They do not
   yet read demand-wise or scheme-wise state spending. A state page shows the
   headline budget and its trajectory, not a per-scheme breakdown.
2. **Actuals lag by one to two years and are often provisional.** A state's
   audited accounts (the CAG-certified Finance Accounts) arrive well after the
   year closes. Until then the "Accounts" figure is provisional and is flagged as
   such. There is no state equivalent of the CGA monthly cadence, so state
   expenditure is annual, not monthly, and mid-year "spent so far" is not
   available the way it is for the Union.
3. **Document structure is inconsistent across states and across years.** Column
   headers, unit conventions (crore vs lakh), and even whether the summary is
   HTML or a scanned PDF differ by state and change between budgets. Each state is
   its own mini-pipeline for a reason, and structural drift is expected; the drift
   sentinel is armed accordingly.
4. **Central transfers are embedded in state totals and cannot be separated here.**
   A state total blends the state's own revenue with central transfers it
   receives. That is correct as a state figure, but it is why the product never
   adds a state total to the Union total (section 2). The share that is central
   money is not modelled at the fact level yet.
5. **Union territories without legislatures have no budget of their own.** Their
   spending sits inside the Union budget, so a "state budget" page for them would
   be misleading; `has_legislature` marks them.
6. **State-implemented CSS visibility depends on SNA reporting** (docs/03 limitation
   3). Whether a state's spending of a central release is even visible varies by
   scheme and by state, so any reconciliation of "central release versus state
   spend" is partial and must be labelled so.

## 6. Adding a new state, checklist

1. Seed the state in `db/seed/07_states.sql` (already done for all 28 + 8).
2. Add a `source_registry` row with `jurisdiction = 'state'` and an honest
   `access_note` (docs/08).
3. Seed entity aliases resolving the state's name variants to its id.
4. Add a pipeline module under `pipelines/sources/state_<name>/` that holds every
   URL in one constant, parses the Budget at a Glance, and writes facts only under
   `entity_type = 'state'`.
5. Register it in `pipelines/sources/__init__.py` and add its id to
   `KNOWN_SOURCE_IDS` in `pipelines/lib/config.py`.
6. Add a fixture and tests; never make a network call in a test.
7. Run the invariants: `pnpm --filter @nidhi/db check` must report zero errors,
   which includes `state_source_in_union_ledger` and `state_fact_unknown_state`.
