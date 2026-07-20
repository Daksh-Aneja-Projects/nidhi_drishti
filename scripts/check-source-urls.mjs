/**
 * Probe every source URL the pipelines depend on.
 *
 * Government portals reorganise constantly. docs/03 says the institution is
 * stable but the URL may not be, so this script exists to answer "which of our
 * constants still resolve" without running an ingestion. It makes plain GET
 * requests, one at a time, with the project's honest User-Agent and a courteous
 * delay, exactly as the pipelines would (docs/08 section 1).
 *
 * It reads nothing and writes nothing. It only reports status.
 *
 * Run with: node scripts/check-source-urls.mjs
 */

const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  'NidhiDrishti/1.0 (public budget transparency project; contact@example.org)';

const DELAY_MS = 2000;
const TIMEOUT_MS = 25_000;

/**
 * The URLs are grouped by source id so a failure names the pipeline module that
 * has to change. `kind` distinguishes the landing page, which tells us the
 * institution is still there, from the document path we actually parse.
 */
const TARGETS = [
  { source: 'union_budget', kind: 'home', url: 'https://www.indiabudget.gov.in/' },
  { source: 'union_budget', kind: 'doc', url: 'https://www.indiabudget.gov.in/doc/eb/allsbe.pdf' },
  { source: 'union_budget', kind: 'doc', url: 'https://www.indiabudget.gov.in/doc/eb/sumsbe.pdf' },
  { source: 'union_budget', kind: 'doc', url: 'https://www.indiabudget.gov.in/doc/bag/bag1.pdf' },

  { source: 'cga_monthly', kind: 'home', url: 'https://cga.nic.in/' },
  { source: 'cga_monthly', kind: 'doc', url: 'https://cga.nic.in/MonthlyReport.aspx' },

  { source: 'pfms_pub', kind: 'home', url: 'https://pfms.nic.in/' },
  { source: 'pfms_pub', kind: 'doc', url: 'https://pfms.nic.in/SchemeWiseReleases.aspx' },

  { source: 'ogd', kind: 'home', url: 'https://data.gov.in/' },
  { source: 'ogd', kind: 'api', url: 'https://api.data.gov.in/' },

  { source: 'obi', kind: 'home', url: 'https://openbudgetsindia.org/' },

  { source: 'rbi', kind: 'home', url: 'https://www.rbi.org.in/' },

  { source: 'cppp', kind: 'home', url: 'https://eprocure.gov.in/eprocure/app' },
  {
    source: 'cppp',
    kind: 'doc',
    url: 'https://eprocure.gov.in/eprocure/app?page=FrontEndLatestActiveTenders&service=page',
  },

  { source: 'gem', kind: 'home', url: 'https://gem.gov.in/' },
  { source: 'gem', kind: 'doc', url: 'https://gem.gov.in/statistics' },

  { source: 'pib', kind: 'home', url: 'https://pib.gov.in/' },
  { source: 'pib', kind: 'doc', url: 'https://pib.gov.in/allRel.aspx' },

  { source: 'sansad_qa', kind: 'home', url: 'https://sansad.in/' },
  { source: 'sansad_qa', kind: 'doc', url: 'https://sansad.in/ls/questions/questions-and-answers' },
  { source: 'sansad_qa', kind: 'doc', url: 'https://sansad.in/rs/questions/questions-and-answers' },

  // Flagship scheme portals (docs/03 section 2.6).
  { source: 'mgnrega', kind: 'home', url: 'https://nrega.nic.in/' },
  { source: 'mgnrega', kind: 'doc', url: 'https://nreganarep.nic.in/netnrega/all_lvl_details_dashboard_new.aspx' },
  { source: 'pmkisan', kind: 'home', url: 'https://pmkisan.gov.in/' },
  { source: 'jjm', kind: 'home', url: 'https://jaljeevanmission.gov.in/' },
  { source: 'pmgsy', kind: 'home', url: 'https://omms.nic.in/' },
  { source: 'egramswaraj', kind: 'home', url: 'https://egramswaraj.gov.in/' },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function probe(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    // Read a little of the body: a portal that answers 200 with an error page
    // is the failure mode that silently poisons a pipeline.
    let bytes = 0;
    try {
      bytes = (await response.arrayBuffer()).byteLength;
    } catch {
      bytes = 0;
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType: contentType.split(';')[0],
      bytes,
      finalUrl: response.url !== target.url ? response.url : null,
    };
  } catch (error) {
    return { ok: false, status: 0, error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`Probing ${TARGETS.length} URLs as: ${USER_AGENT}\n`);
  const results = [];

  for (const target of TARGETS) {
    const result = await probe(target);
    results.push({ ...target, ...result });
    const label = `${target.source}/${target.kind}`.padEnd(22);
    if (result.ok) {
      const redirect = result.finalUrl ? ` -> ${result.finalUrl}` : '';
      console.log(
        `  OK   ${label} ${String(result.status)} ${result.contentType} ${(result.bytes / 1024).toFixed(0)}kB${redirect}`,
      );
    } else {
      console.log(`  FAIL ${label} ${result.status || ''} ${result.error ?? ''}`.trimEnd());
    }
    await sleep(DELAY_MS);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} reachable.`);
  if (failed.length > 0) {
    console.log('\nUnreachable:');
    for (const f of failed) {
      console.log(`  ${f.source}/${f.kind}  ${f.url}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
