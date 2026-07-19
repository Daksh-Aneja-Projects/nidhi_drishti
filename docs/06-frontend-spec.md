# 06 — Frontend Spec (Dashboard UX)

Design tone: serious civic data product — closer to USASpending.gov / FT data journalism than a SaaS admin panel. Dense but legible. Read `/mnt/skills/public/frontend-design/SKILL.md` before building UI.

## Hard UI standards (non-negotiable)
1. **Icons**: Lucide SVG icons only, consistent stroke weight, sized via a shared `<Icon>` wrapper. Emojis are banned in all UI surfaces (empty states, toasts, anomaly cards, share cards, meta descriptions).
2. **Distinctive design system**: custom typography pairing (e.g. a serif display for headline figures + a clean grotesque for data), a defined color token set including the diverging burn-ratio scale, real spacing scale. No default Tailwind-blue generic look, no stock shadcn appearance without theming.
3. **UI copy**: no em-dashes in any user-facing string; restructure sentences instead. Sentence case for labels. All strings in the i18n dictionary from day one.
4. **No version references** anywhere user-facing: no "v1", "beta" ribbons, changelog badges, or build numbers. Freshness is communicated through data dates, not product versions.
5. **Telemetry built in**: every interactive component fires typed analytics events per docs/09-telemetry.md.

## Global elements (every page)
- **Freshness bar**: per-source last-updated chips ("CGA: Jun 2026 accounts · fetched 29 Jul", "Tenders: today").
- **Provenance affordance**: every displayed number is hoverable/tappable → popover: value, stage (BE/RE/actual), source doc link, document date, fetched date, provisional badge if applicable.
- **Disclaimer footer** (docs/08 text). FY selector (default: current FY). ₹ crore units with Indian grouping; toggle to ₹ lakh crore for national figures.
- Mobile-first responsive; journalists live on phones.

## P1 — National Overview `/`
- Hero: total authority (BE→RE aware), expenditure to date, balance, and the **burn gauge**: % spent vs % FY elapsed (the single most shareable visual — make it excellent).
- Treemap: ministries sized by allocation, colored by burn_ratio (diverging scale; colorblind-safe).
- "Attention" strip: top approved anomaly flags (cards → detail).
- Monthly national spend line: this FY vs 3-yr average band.
- Top movers table: biggest RE-vs-BE swings, most under-utilized, fastest burners.

## P2 — Ministry `/ministry/[id]`
- Waterfall: BE → RE/supplementary → expenditure → balance.
- Monthly spend bars (de-cumulated) with prior-FY ghost bars; provisional months hatched.
- Scheme table (sortable: allocation, releases, utilization%, flags).
- Revenue vs capital split. YoY allocation trend (5 FYs). Tender activity sparkline (Tier-2 labeled).
- Tabs: Overview · Schemes · Verification · Flags · Data & sources.

## P3 — Scheme `/scheme/[id]`
- Allocation vs releases vs utilization (three-bar with explicit stage labels + "not reported" states — never render missing utilization as zero).
- Linked tenders list; evidence timeline (PIB/news/parliament items).
- Verification tab → A4 report (cached; "Regenerate" for logged-in reviewers only).

## P4 — Anomaly Feed `/flags`
- Filterable cards: rule, severity, ministry, FY. Each card: metric visual, plain-language explanation, evidence links, "what this does NOT prove" line (credibility armor).

## P5 — Verification (live page) `/verify/[entity]`
- The differentiator page. Layout: left = fiscal facts panel (official numbers); right = evidence stream (tenders, PIB, news, parliament) on a timeline; center = AI narrative with numbered citation chips linking both sides.
- Prominent label: "AI-assembled · sources cited · generated <date>".

## P6 — Search, Compare, Export
- Global search (ministries/schemes). `/compare` — up to 4 entities, aligned metrics. CSV export button on every table; `/api-docs` for the public API.

## Component/stack notes
- Next.js App Router; server components for data pages; ECharts (treemap+waterfall strong) or Recharts — pick one, stay consistent.
- Charts must render server-side-snapshot for OG images (shareability on X/WhatsApp drives adoption — auto-generated share cards per ministry with the burn gauge).
- Number formatting util: `formatINRCr(1234567.89) → "₹12,34,567.89 cr"`. Hindi locale toggle is v2; keep strings in a dictionary from day 1.
- Accessibility: all charts get data-table fallbacks; color scales colorblind-safe; keyboard navigable.
- Performance: static/ISR for all public pages; target LCP < 2.5s on 4G.
