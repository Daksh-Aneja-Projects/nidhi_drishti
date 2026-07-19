# 01 — Product Requirements Document

## 1. Problem
India's Union Budget allocates ~₹48+ lakh crore annually across 100+ ministries and 700+ schemes. The data to answer "how much was allocated, how much has actually been spent, and what is left" exists — but it is fragmented across the Union Budget documents, CGA monthly accounts, PFMS dashboards, ministry demand-for-grants, and scheme portals, in inconsistent formats (PDF, portal widgets, CSVs). No single product shows allocation vs. actual spend vs. balance, live, with anomaly detection and ground-truth verification.

## 2. Product vision
A live national budget dashboard that any citizen, journalist, researcher, or policymaker can open and see, for every ministry / sector / major scheme:
- **Allocated** (BE and RE)
- **Spent so far** (CGA actuals + PFMS releases)
- **Balance remaining** and burn-rate vs. time-elapsed-in-FY
- **Anomalies** (March-rush dumping, chronic under-utilization, spend spikes without matching tenders)
- **Verification signal**: does money-out correlate with observable activity (tenders floated, contracts awarded, press coverage)?

Positioning note: the "for Presidents and PMs" framing is the long-term pitch; the buildable v1 is the **public transparency product** requiring zero government permission. A government/PMO edition is a later commercial fork, not v1.

## 3. Users & jobs-to-be-done
| Persona | Job |
|---|---|
| Journalist | "Which ministries are sitting on unspent funds in Q3? Give me a citable number and source." |
| Policy researcher / think tank | Time-series utilization by scheme; export to CSV. |
| Engaged citizen | "Where does my ministry-of-interest's money actually go?" Simple, visual. |
| MP/MLA staff, opposition research | Question Hour ammunition: utilization % with provenance. |
| (Later) Finance ministry / PMO | Command view — same engine, private deployment. |

## 4. Core features (v1)
1. **National overview**: total BE/RE, expenditure to date (CGA), % of FY elapsed vs % spent, top 10 ministries by allocation and by under-utilization.
2. **Ministry pages**: allocation waterfall (BE → RE → spend → balance), monthly spend trend, scheme list, YoY comparison.
3. **Scheme pages** (top ~200 schemes): releases via PFMS-published data, utilization where reported, linked tenders.
4. **Anomaly feed**: rule-based + statistical flags, each with plain-language explanation and evidence links.
5. **Live verification page** (the "scrape the internet" layer, done right): for a selected scheme/ministry, agents pull recent tenders (CPPP/GeM), press releases (PIB), and news, and produce a sourced narrative: "₹X released; tenders worth ₹Y floated; Z news reports of ground activity." Clearly labeled as AI-assembled with citations.
6. **Provenance UI**: every number clickable → source doc, date, extraction method.
7. **Data freshness banner**: per-source last-updated.
8. **Search**: ministry/scheme/keyword.
9. **Export**: CSV per view; public read-only API (rate-limited).

## 5. Explicit non-goals (v1)
- State budgets (Phase 3; the 28-state treasury landscape is its own project).
- Beneficiary-level DBT data (privacy + access barriers).
- Real-time in the literal sense: "live" = as fresh as sources allow (CGA monthly, PFMS-published figures, tenders daily). The UI must never imply per-minute treasury feeds.
- Editorializing / corruption accusations. We show data + flags; interpretation carries confidence labels and citations.

## 6. Success metrics
- v1 launch: 100% of Union Budget ministries covered with BE/RE; CGA monthly actuals ingested within 3 days of publication; ≥150 major schemes with release data.
- Data integrity: 0 numbers without provenance; scraper drift alerts < 24h to detection.
- Adoption: cited by ≥3 media outlets in first 6 months; ≥500 monthly active researchers.

## 7. Key risks
| Risk | Mitigation |
|---|---|
| Source format changes break pipelines | Raw-artifact storage + schema validation + drift alerts (CLAUDE.md principle 5) |
| PFMS has no open API | Use published dashboards/reports + data.gov.in datasets; treat PFMS figures as "as published", never claim treasury integration |
| Misinterpretation ("govt hid money!") from RE/supplementary-grant mechanics | Model fiscal stages correctly (docs/04); explainer tooltips |
| Legal pushback on scraping | Only public, non-authenticated sources; robots.txt respect; see docs/08 |
| Anomaly false positives damage credibility | Every flag ships with evidence + confidence; human-review queue before public feed in early months |

## 8. Monetization (later, optional)
Free public tier forever (credibility depends on it). Paid: API access at volume, custom reports, embeds for newsrooms, and eventually the private government edition.
