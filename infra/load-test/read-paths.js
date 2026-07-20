import http from 'k6/http';
import { check, group, sleep } from 'k6';

/**
 * Load test for the public read paths (docs/07 Phase 5, docs/02 section 6).
 *
 * Covers the pages and API routes a real reader or API consumer hits: the
 * national overview, the ministry list, one ministry page, and the two
 * cached JSON aggregates behind them. Everything here is a GET against our
 * own deployment; nothing touches a government source, so docs/08's scraping
 * posture (politeness delay, robots, User-Agent) does not apply to this
 * script -- it is a load test of our own infrastructure, run against our own
 * server.
 *
 * Run against a local server: see README.md in this directory.
 */

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const MINISTRY_ID = __ENV.MINISTRY_ID || 'min-agriculture';
const TARGET_VUS = Number(__ENV.VUS || 10);

export const options = {
  scenarios: {
    read_paths: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: TARGET_VUS },
        { duration: '1m', target: TARGET_VUS },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    // No request should error outright (connection refused, 5xx, timeout).
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],

    // docs/02 section 6: "All public dashboard endpoints served from
    // materialised views + Redis ... Target p95 < 300ms." That target is
    // scoped here to the two cached JSON aggregate routes specifically,
    // tagged per request below, rather than applied to every URL this script
    // touches.
    'http_req_duration{endpoint:api_national}': ['p(95)<300'],
    'http_req_duration{endpoint:api_ministries}': ['p(95)<300'],

    // Informational, not the docs/02 contract: an HTML page additionally
    // pays for the App Router shell, fonts and the freshness-bar query, none
    // of which the JSON aggregate carries. Kept generous so this script
    // still catches a real regression (a page that used to render in 200ms
    // now taking 5s) without being a false alarm on the SSR cost itself.
    'http_req_duration{endpoint:page_home}': ['p(95)<1000'],
    'http_req_duration{endpoint:page_ministries}': ['p(95)<1000'],
    'http_req_duration{endpoint:page_ministry_detail}': ['p(95)<1000'],
  },
};

function get(path, endpointTag) {
  const res = http.get(`${BASE_URL}${path}`, { tags: { endpoint: endpointTag } });
  check(
    res,
    { [`${endpointTag}: status is 200`]: (r) => r.status === 200 },
    { endpoint: endpointTag },
  );
  return res;
}

export default function () {
  group('pages', () => {
    get('/', 'page_home');
    get('/ministries', 'page_ministries');
    get(`/ministry/${MINISTRY_ID}`, 'page_ministry_detail');
  });

  group('api', () => {
    get('/api/v1/national', 'api_national');
    get('/api/v1/ministries', 'api_ministries');
  });

  sleep(1);
}
