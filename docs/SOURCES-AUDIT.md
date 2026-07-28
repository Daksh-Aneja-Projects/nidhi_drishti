# Source access audit

Re-run 2026-07-28, every row fetched from a live host with the project's own
client: `User-Agent: NidhiDrishti/1.0 (public budget transparency project)`,
`From: contact@example.org`, robots consulted, 2s minimum between requests to a
host.

**This supersedes the earlier audit, which was wrong about the most important
row.** `indiabudget.gov.in` was recorded as WAF-blocked for months. It was not
blocking the project; it rejects any User-Agent containing an email address or a
URL, and our own compliance rule put one there. See `pipelines/lib/config.py`.

Two access facts explain most of what used to look like blocking:

1. **A User-Agent carrying an address is refused** by `indiabudget.gov.in`. The
   contact belongs in `From` (RFC 9110 section 10.1.2), which is now enforced.
2. **Some hosts need legacy TLS renegotiation.** `doe.gov.in` and `dea.gov.in`
   reset the connection against a default OpenSSL 3 context and answer 200 with
   `OP_LEGACY_SERVER_CONNECT` set. Certificate verification is unaffected and
   stays on.

## Reachable

| Source | Endpoint | Granularity | Years | Note |
|---|---|---|---|---|
| Union Budget | `indiabudget.gov.in/doc/eb/allsbe.xlsx` | Demand, BE/RE/Actual | current doc: 3 | 1.86 MB, 103 sheets, unit stated in document |
| Union Budget archive | Wayback CDX over `/doc/eb/*` | Demand | ~665 files | Portal overwrites the path each February; the archive is the only route to prior years |
| CGA monthly | `cga.nic.in/MonthDashboardReport/Published/list.aspx` | National, monthly | 2014-15 → current | `.xlsm`, receipts/expenditure/deficit |
| CGA national summary | `cga.nic.in/NSD/Published/3/{year}.aspx` | National | 1998-99 → 2026-27 | Plain HTML tables |
| DoE Outcome Budget | `doe.gov.in/outcome-budget` | **Scheme**, CS/CSS tagged | 2018-19 → 2026-27 | PDF with a real text layer; needs legacy TLS |
| DEA Detailed DG | `dea.gov.in/reports-detail-demands-grants` | Demand, detailed | 2017-18 → 2026-27 | Ministry of Finance only; other ministries publish on their own domains |
| data.gov.in | `api.data.gov.in` | Varies | Varies | Free key; catalogue is mostly one-off answer tables |
| CAG | `cag.gov.in/en/audit-report` | Audited actuals | Current + archive | PDFs; ids must be harvested, filenames carry a hash |
| RBI DBIE catalogue | `data.rbi.org.in/CIMS_Gateway_DBIE` | Metadata only | 1971 → 2026 | Anonymous JSON; report payloads need JS, so treat as a freshness feed |
| MoSPI eSankhyiki | `api.mospi.gov.in` | Macro | Varies | No budget data; GDP denominators only. Needs legacy TLS |
| PRS | `prsindia.org` | Ministry analysis | Current | **Crawl-delay: 10.** Derived, so a locator and cross-check, never a `source_record` |

## Not reachable, and why

| Source | Reason | Standing |
|---|---|---|
| `openbudgetsindia.org` | Hard 403 to every client including a real browser | Do not retry. Archived copies exist for historical files |
| `rbidocs.rbi.org.in` | JS challenge on the document host | Listing on `www.rbi.org.in` is scrapeable, so URLs are discoverable; fetching needs a browser tier |
| PFMS report pages | 302 to a login | Out of scope: docs/08 permits only anonymous access |
| Bharatkosh | Payment portal, no public data endpoint | Out of scope |
| `dbtbharat.gov.in` | **`robots.txt` is `Disallow: /`** | **Do not crawl.** Not a technical limit, a stated instruction |
| `www.mospi.gov.in` | JS-only shell | Use the eSankhyiki API |
| `eparlib.sansad.in` | Connection timeout from this network | Retry from the deployment environment |

## Standing rules

- A source that says `Disallow` is not crawled, whatever it would yield.
  `dbtbharat.gov.in` is the live example.
- A JS challenge is not something to defeat. Where a document needs JavaScript
  to reach, the answer is a browser worker executing the page as published, or
  the operator intake path, and never a forged header.
- A source that needs a free account needs somebody to open one. NDAP is the
  standing example. That is an operator decision, not a scraper problem.
- Third-party analyses locate documents. They never become the cited figure.
