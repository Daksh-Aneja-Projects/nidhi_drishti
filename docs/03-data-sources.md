# 03 — India Data Sources (the ground truth map)

> Rule: every source below gets its own pipeline module, its own staging schema, and an entry in `source_registry`. Verify URLs and formats at build time — government sites reorganize frequently; the *institution* is stable, the URL may not be.

## Tier 1 — Fiscal facts (authoritative numbers)

### 1.1 Union Budget documents — indiabudget.gov.in
- **What**: Budget Estimates (BE), Revised Estimates (RE), Actuals for prior year; Expenditure Budget vol. by ministry/demand; Demands for Grants; scheme-wise allocation statements (Statement 4A/4B etc.).
- **Format**: PDFs + some XLS. Annual (Feb 1 budget) + supplementary demands during the year.
- **Access**: direct download, no auth.
- **Use**: the ALLOCATION side of every comparison. This is the denominator of the whole product.
- **Quirks**: ministry/demand numbering changes across years; "Grand Total" rows inside tables; figures in ₹ crore usually, sometimes lakh. Build `inr_amounts.py` parser with unit detection.

### 1.2 CGA Monthly Accounts — cga.nic.in (Controller General of Accounts)
- **What**: Monthly Union Government accounts — actual receipts and expenditure (revenue/capital), ministry-wise monthly expenditure vs BE. Published ~last day of following month.
- **Format**: PDFs/HTML tables; some data mirrored on data.gov.in.
- **Use**: the ACTUAL SPEND side, monthly cadence. This is your primary "spent so far" source — official, citable.
- **Quirks**: provisional figures revised later; keep `revision_of` lineage in schema.

### 1.3 PFMS published data — pfms.nic.in / pfmsdashboard.gov.in
- **What**: PFMS is the CGA's fund-flow backbone (scheme releases, DBT, SNA accounts for Centrally Sponsored Schemes). Public *dashboards* exist; there is **no open public API** — do not architect as if there is.
- **Access**: scrape published dashboard widgets/reports (Playwright likely needed), plus periodic reports and press releases citing PFMS figures.
- **Use**: scheme-level RELEASE data where published; SNA/CNA fund-flow context.
- **Quirks**: JS-rendered; figures may be cumulative-FY — never sum cumulative snapshots. Label all PFMS-derived figures "as published on PFMS dashboard, <date>".

### 1.4 data.gov.in (OGD Platform)
- **What**: Thousands of official datasets incl. expenditure, scheme utilization, budget series. Has a real API (api.data.gov.in, free API key).
- **Use**: wherever a dataset mirrors Tier-1 sources in machine-readable form, prefer it. Registry of dataset IDs kept in `source_registry`.
- **Quirks**: update cadence varies wildly per dataset — check `updated_date` per resource, alert on staleness.

### 1.5 Open Budgets India — openbudgetsindia.org (CivicDataLab)
- **What**: Cleaned, machine-readable Union + state budget data. NGO-maintained, high quality.
- **Use**: bootstrap historical BE/RE series fast; cross-check our own budget parsing. Check license (CC) and attribute.

### 1.6 RBI — rbi.org.in
- **What**: Weekly/monthly government finance statistics, WMA, deficit financing context.
- **Use**: macro context panels (fiscal deficit trajectory). Low priority v1.

## Tier 2 — Verification signals (the "is money turning into activity" layer)

### 2.1 CPPP — Central Public Procurement Portal (eprocure.gov.in)
- **What**: Central tenders — floated, corrigenda, awards (AOC). Searchable, public.
- **Use**: match tenders/awards to ministries & schemes → "₹X released, tenders worth ₹Y floated." Core evidence for the verification agent.
- **Quirks**: inconsistent org naming (heavy entity-alias work); values sometimes absent; CAPTCHA on some flows — scrape listing/RSS-ish endpoints politely, daily.

### 2.2 GeM — Government e-Marketplace (gem.gov.in)
- **What**: Government purchases of goods/services; publishes aggregate procurement stats.
- **Use**: procurement activity signal per ministry. Aggregates first; item-level later if accessible.

### 2.3 PIB — Press Information Bureau (pib.gov.in)
- **What**: Official press releases per ministry. RSS/archives available.
- **Use**: announcements of releases/launches/milestones → verification narratives with official citations. Daily ingest, tag by ministry, embed for retrieval.

### 2.4 News media (curated)
- **What**: Business press budget/spend coverage (via RSS + web search API).
- **Use**: tertiary evidence only, always labeled as media reporting, always linked. Never a source for a fiscal number on a chart.

### 2.5 Parliament questions — sansad.in (Lok Sabha/Rajya Sabha Q&A)
- **What**: Ministries' written answers frequently contain scheme utilization tables not published elsewhere. Public PDFs.
- **Use**: high-value utilization data + built-in citability. Search by scheme name per session. (Sleeper source — most competitors ignore it.)

### 2.6 Scheme-specific portals (Phase 2+)
- MGNREGA (nrega.nic.in — rich public reports), PM-KISAN, Jal Jeevan Mission dashboard, PMGSY (OMMAS), eGramSwaraj (panchayat spend). Each is its own mini-pipeline; add top 10 flagship schemes one at a time.

## Tier 3 — Reference data
- **Ministry/Demand master**: build from Budget docs annually; stable IDs across years via `entity_alias`.
- **Scheme master**: from Statement of scheme allocations + NITI/DBT Bharat scheme lists.
- **FY calendar utilities**: Apr–Mar, quarter mapping, "% of FY elapsed".

## Source registry table (seed in db/seed)
| source_id | name | tier | cadence | method | format |
|---|---|---|---|---|---|
| union_budget | India Budget portal | 1 | annual + supplementary | download | PDF/XLS |
| cga_monthly | CGA Monthly Accounts | 1 | monthly | download/scrape | PDF/HTML |
| pfms_pub | PFMS published dashboards | 1 | weekly check | playwright | HTML |
| ogd | data.gov.in datasets | 1 | per-dataset | API | JSON/CSV |
| obi | Open Budgets India | 1 | annual | download | CSV |
| cppp | CPPP tenders | 2 | daily | scrape | HTML |
| gem | GeM stats | 2 | weekly | scrape/API | HTML/JSON |
| pib | PIB releases | 2 | daily | RSS/scrape | HTML |
| sansad_qa | Parliament Q&A | 2 | per session | scrape | PDF |
| news | Curated media | 2 | daily | RSS/search API | HTML |

## Honest limitations (surface these in the product)
1. True real-time treasury data is not public. "Live" = monthly official actuals + more frequent published/derived signals. Say so in the UI.
2. Utilization Certificates (UCs) are largely not public per-scheme; utilization coverage will be partial (CGA + parliament answers + scheme portals).
3. State-implemented CSS spending visibility depends on SNA reporting; label confidence accordingly.
