# 13 — Source URL audit (20 July 2026)

Result of probing every pipeline URL constant with `scripts/check-source-urls.mjs`,
using the project's honest User-Agent, one request per two seconds, from a
residential Windows machine in India. 11 of 27 URLs answered usefully. This file
records what that means per source, because the difference between "the URL is
wrong", "the portal blocks non-browser clients" and "the page is behind a login"
dictates three different responses.

Re-run the probe any time with: `node scripts/check-source-urls.mjs`

## Findings that require action

### PFMS: the guessed report path lands on a login page
`pfms.nic.in/SchemeWiseReleases.aspx` answers 200 but redirects to
`SitePages/Users/LoginDetails/Login.aspx`. That page is authenticated, and
docs/08 section 1 is absolute: we never touch authenticated endpoints. The
pipeline constant must not point there. The public dashboard home does serve
(200), so the Playwright path through the public dashboard widgets is the only
compliant route, exactly as docs/03 section 1.3 anticipated. The
`SchemeWiseReleases.aspx` constant was a placeholder guess and is now replaced.

### Portals answering 403 to a non-browser client
`indiabudget.gov.in`, `data.gov.in`, `openbudgetsindia.org` and `pib.gov.in` all
answer 403 to a plain fetch with our honest User-Agent, while serving normally
to a browser. This is WAF bot filtering, not a wrong URL and not a login.

Posture, per docs/08: we do not spoof a browser User-Agent and we do not evade
bot detection. The compliant options, in order of preference:

1. `data.gov.in` has a real API at `api.data.gov.in` that requires a key; the
   403/404 here simply reflects the missing key and the bare host. With
   `OGD_API_KEY` set, the API path is expected to work and is the preferred
   route for everything it mirrors.
2. For the Budget PDFs and PIB, a Playwright fetch of the public page is a real
   browser and is not evasion; it is the same access any member of the public
   has. Where even that is refused, the fallback is manual periodic download,
   recorded in source_registry.access_note, which docs/08 explicitly allows.
3. Open Budgets India publishes datasets with direct CKAN resource URLs that
   may behave differently from the site root; verify per dataset.

### CPPP answering 500
`eprocure.gov.in` returned 500 on both probes. Likely transient load or
maintenance rather than a moved page; the portal is notoriously fragile. The
pipeline's drift alerting treats repeated 5xx as an outage, not as drift. Re-run
the probe before concluding anything.

### CGA, PMGSY (OMMAS), MGNREGA report host: connection failures
`cga.nic.in`, `omms.nic.in` and `nreganarep.nic.in` did not answer at all
(TLS/connection failure rather than an HTTP error). NIC hosts frequently refuse
non-browser TLS handshakes or drop foreign/datacenter traffic. Treat as
"requires a browser-grade client" until proven otherwise, and verify from the
deployment region before writing off the URL.

### Rajya Sabha questions path
`sansad.in/rs/questions/...` failed where the Lok Sabha path serves. The RS path
constant needs verifying against the live site's navigation.

## Working now, as probed

| URL | Status | Note |
|---|---|---|
| pfms.nic.in | 200 | public dashboard home |
| rbi.org.in | 200 | |
| gem.gov.in and /statistics | 200 | aggregate statistics page serves |
| sansad.in home and LS questions | 200 | |
| pmkisan.gov.in | 200 | |
| jaljeevanmission.gov.in | 200 | |
| egramswaraj.gov.in | 200 | |
| nrega.nic.in | 200 | but answers 0 bytes to a plain fetch; JS-rendered, needs Playwright |

## Standing conclusions

1. Playwright is not an optimisation, it is the baseline for most Tier 1
   sources. The plain-httpx path works for a minority.
2. Every pipeline whose URL failed here must keep its drift alerting primed to
   distinguish outage (5xx, connection refused) from relocation (404) from
   blocking (403). Those three need different human responses, and the runbook
   (docs/11) covers each.
3. Nothing in this audit changes the legal posture: honest UA, no evasion, no
   authenticated pages, rate limits. Where a portal will not serve a
   non-browser client, we use a real browser or a manual download, and record
   the decision in source_registry.access_note.
