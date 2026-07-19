# 08 — Legal, Compliance & Responsible Publishing

Not legal advice — a working checklist. Before public launch, get a one-time review from an Indian tech/media lawyer (budget ~₹30–60k), specifically on scraping posture and defamation exposure.

## 1. Data access posture
- **Only public, non-authenticated sources.** Never bypass logins, CAPTCHAs, paywalls, or technical access controls (relevant to IT Act §43/§66 exposure — access must stay "authorized" i.e., what the site serves any public visitor).
- Respect robots.txt per source; if a Tier-1 source disallows crawling, prefer its data.gov.in mirror or manual periodic download, and document the decision in source_registry.
- Rate limits: ≤1 req/2s per government domain, off-peak scheduling for heavy jobs, honest User-Agent with contact email. We are guests on public infrastructure.
- Government of India data policy (NDSAP) and the GODL (Government Open Data License – India) generally permit reuse of published government data with attribution — attribute per source on the "Data & sources" page.
- Open Budgets India: check current CC license; attribute CivicDataLab.

## 2. Publishing posture (defamation-aware by design)
- We publish **data + methodology**, not accusations. Banned words in product copy for flags: "scam", "fraud", "siphoned", "corrupt". Approved framing: "utilization below 40% at 75% of FY elapsed", "no matching tenders found in CPPP for this period (which may reflect procurement outside CPPP)".
- Every anomaly card carries a "what this does not prove" line.
- AI-generated narratives: labeled, cited, with a self-check pass (docs/05 A4); publish a public methodology page describing rules, sources, and known limitations.
- Corrections policy: visible "report an error" link; corrections logged publicly. Credibility is the entire moat.

## 3. Site-wide disclaimer (footer, every page)
> Nidhi Drishti is an independent transparency project. It is not affiliated with the Government of India. All figures are compiled from cited public sources and may be provisional or revised. AI-assembled analyses are labeled and cite their sources. For official figures, refer to indiabudget.gov.in, cga.nic.in, and pfms.nic.in.

## 4. Privacy & user data
- v1 collects no user PII (no accounts). If v1.1 adds email digests: DPDP Act 2023 basics — consent, purpose limitation, delete-on-request, no sharing. Analytics: privacy-respecting (Plausible/self-hosted), no ad trackers.
- Never ingest beneficiary-level DBT data even where technically visible; aggregate only.

## 5. Operational
- Keep raw artifacts (immutable, hashed) — they are the evidence trail if any figure is challenged.
- Register a clean entity later if monetizing (LLP/Pvt Ltd); for now personal project with clear ownership of the domain and repos.
- Trademark check the final product name before spending on branding.
