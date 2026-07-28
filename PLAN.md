# What to build next

Written 2026-07-28, after the Union Budget portal turned out to be reachable.
Two perspectives, then one sequenced plan. Everything below is scoped against
what the repository can actually do today.

---

## The fact that reorders everything

Until today the analysis ceiling was set by data: **43 ministries, one fiscal
year, one expenditure date**. That supports exactly two measures, absorption and
pace against a straight line, which is what `/analysis` computes.

`indiabudget.gov.in` is now fetchable. `allsbe.xlsx` is 1.86 MB, 103 sheets,
demand level, carrying `Actuals 2024-25 | BE 2025-26 | RE 2025-26 | BE 2026-27`.
The Internet Archive holds 665 more `.xls/.xlsx` under `/doc/eb/`, and the
portal overwrites that path each February, so the archive is the only route to
prior years. CGA publishes a monthly workbook with a national series back to
2014-15.

That takes the panel from **43 × 1 × 1** to roughly **102 demands × 8 years ×
4 stages**, plus 140 monthly national observations. Nearly every analysis worth
doing is unlocked by that one change, and almost none of them are worth
attempting before it. So the data work is not a parallel track to the analysis
work. It is the first half of it.

---

## Perspective 1: data and analytics

### What is weak today, stated plainly

- One year of data means no ministry has a baseline of its own. Every comparison
  is cross-sectional, and cross-sectional comparison of ministries is close to
  meaningless: Defence and Minority Affairs have different spending shapes for
  reasons that are structural, not behavioural.
- A straight line is a weak null hypothesis. Real spending is seasonal, and the
  Indian fiscal year has a pronounced March effect. Comparing to a straight line
  when a seasonal baseline is available is leaving the actual finding on the
  table.
- `/analysis` ranks. Ranking without an uncertainty statement invites the reader
  to treat position 7 and position 9 as different, when the underlying figures
  are rounded to the crore and revised quarterly.

### The analyses that become possible, in order of value

**1. March rush.** The share of a ministry's annual spend falling in Q4, and in
March alone. This is the single most documented pathology in Indian public
finance and the CAG reports on it annually. It needs monthly data per ministry
and a multi-year baseline. `rule_march_rush` already exists in
`agents/a3_anomaly/rules.py` with no data to run on.

**2. Revision behaviour.** For each demand, the distribution of `RE - BE` over
years. A ministry whose RE is cut 20% every single year is telling you its BE is
not a forecast. This needs the multi-year panel and nothing else, and it is
computable the day the Wayback ingestion lands.

**3. Year-end landing forecast.** Given spend to date and that ministry's own
seasonal profile from prior years, the projected close, with an interval. This
is the number a journalist actually wants in December and nobody publishes.
Requires the monthly panel; must ship with the interval, never a point estimate.

**4. Lapse and surrender proxy.** `RE - Actual` at year end, by demand, over
time. Persistent unspent authority is the finding that connects to outcomes.

**5. Outlier detection against own history**, not against other ministries.
A robust z-score (median and MAD, not mean and SD, because n is small and
budget series have real jumps) of this year's absorption against that demand's
own prior years. This is what makes a signal defensible.

### Method rules to hold to

- **Baseline is the entity's own history.** Cross-ministry comparison only within
  a sector, and only with the size difference stated.
- **Robust statistics.** Median and MAD; n is 8 at best and one Covid year will
  wreck a mean.
- **Small-n guard.** Below 4 prior years, report the figures and refuse the
  z-score rather than computing one nobody should trust.
- **Every signal states what it does not establish.** Already the house rule; it
  is what separates this from a consultancy deck.
- **Revisions are lineage, not corrections.** A figure that changed is two facts
  with an order, which the schema already models. Use it: "this was revised down
  three times" is itself a finding.

---

## Perspective 2: interface and experience

### What is weak today, stated plainly

- **There is no "so what" layer.** Every page is a competent presentation of
  figures and none of them tell the reader what changed since they last looked,
  or what is unusual. A transparency product that requires you to already know
  what to look for serves people who already have analysts.
- **The tables and the charts are separate objects.** Selecting a mark does not
  filter the table; sorting the table does not highlight the chart. On a page
  whose whole job is comparison, that is the interaction that is missing.
- **Density is low for the audience.** Journalists and researchers want more per
  screen, not less. The current pages are generous with whitespace in a way that
  suits a marketing site.
- **No narrative annotation.** The most valuable thing on a fiscal chart is
  usually a note saying why a line moved. There is nowhere to put one.

### What to build

**1. A "what changed" strip.** On every entity page: the figures that moved
since the last ingestion, with the document that moved them. This is the single
highest-value addition and it is cheap, because the revision lineage is already
in the schema.

**2. Crossfilter.** The distribution, the dumbbell and the scorecard on
`/analysis` should be one linked view. Hover a mark, the row highlights. Filter
by sector, all three respond. This is what turns three charts into an
instrument.

**3. Sparklines in the table.** Once the multi-year panel exists, an
eight-year absorption sparkline per row makes the table scannable in a way no
amount of sorting achieves.

**4. Small multiples for the sector view.** Twelve small pace tracks beat one
crowded chart for "how is health doing versus education".

**5. An annotation layer.** A dated note attached to an entity and rendered on
its charts. "RE cut in the December supplementary." Sourced and datable like
everything else.

**6. Density pass.** Tighten vertical rhythm on the table-heavy pages; keep the
generosity for the hero and the methodology prose, where it is doing work.

### The one thing to protect

The provenance affordance and the "not reported" treatment are the product's
actual differentiators and they are already right. No density or polish pass
gets to weaken either.

---

## Sequenced plan

**Phase 1, unblock the panel.** The prerequisite for everything else.
1. DONE. `openpyxl` added; `union_budget` reads the real `allsbe.xlsx` and
   writes 280 facts, 69 ministries across four stages plus national totals,
   FY2022 to FY2027. FY2026 BE lands on the published 50.65 lakh crore.
2. Wayback CDX ingestion keyed by timestamp, so prior years are addressable.
   Record the CDX timestamp and digest in `source_record`; the archive is the
   custodian, not the publisher, and the provenance must say so.
3. CGA monthly workbook to the national monthly series.
4. DONE for the current document: 11 missing bodies and 34 aliases seeded from
   the budget's own demand list, and demands are summed per ministry rather than
   overwriting each other. Cross-year resolution proper still matters once prior
   years arrive from the archive, because demand numbering is renewed annually.

**Phase 2, the analyses.** March rush, revision behaviour, landing forecast,
lapse proxy, own-history outliers. Each one lands as a rule in the existing
anomaly engine plus a section on `/analysis`, with its limits.

**Phase 3, the interface.** What-changed strip, crossfilter, sparklines, small
multiples, annotations, density.

**Phase 4, the honest deployment.** Nothing ships publicly until the pipelines
run on a schedule and the freshness bar reads mostly green, because a
transparency product whose own data is stale is making the argument against
itself.

---

## Sequencing note

Phases 2 and 3 are both blocked on Phase 1 and neither is blocked on the other,
so the interface work can proceed against the current single-year data as long
as it degrades honestly when a series has one point. It already has to: that is
the same discipline as "not reported".
