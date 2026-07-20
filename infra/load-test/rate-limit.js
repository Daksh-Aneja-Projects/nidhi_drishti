import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

/**
 * Proves the public API's rate limiter degrades gracefully under a burst:
 * once the per-minute allowance is used up, the server keeps answering with
 * 429 rather than erroring, timing out, or falling over (docs/02 section 7,
 * apps/web/src/lib/rate-limit.ts).
 *
 * This is a *correctness* test disguised as a load test, not a capacity
 * test: the pass condition is "every response was either served or
 * correctly refused", plus "at least one refusal actually happened". A run
 * that never sees a 429 has not exercised the limiter and should be treated
 * as inconclusive, not as a pass -- that is why `rate_limited_responses` has
 * its own threshold rather than being folded into `checks`.
 *
 * All requests in this script omit X-Forwarded-For, so a local server
 * (which has no reverse proxy in front of it) buckets every VU under the
 * same "unknown" client address and the limit is reached quickly and
 * deterministically. Run against a local server: see README.md.
 */

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TARGET_PATH = __ENV.RATE_LIMIT_PATH || '/api/v1/national';
// Comfortably above PUBLIC_API_RATE_LIMIT_PER_MINUTE's default of 60/min, so
// the burst exhausts the bucket well inside the run duration.
const REQUESTS_PER_SECOND = Number(__ENV.RATE_LIMIT_RPS || 20);

export const rateLimited = new Counter('rate_limited_responses');
export const unexpectedStatus = new Counter('unexpected_status_responses');

export const options = {
  scenarios: {
    burst: {
      executor: 'constant-arrival-rate',
      rate: REQUESTS_PER_SECOND,
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    // Anything other than "served" or "correctly refused" is the limiter (or
    // the process behind it) falling over.
    unexpected_status_responses: ['count==0'],
    // The whole point of the run: the limiter has to actually engage.
    rate_limited_responses: ['count>0'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}${TARGET_PATH}`, { tags: { endpoint: 'rate_limit_probe' } });
  const served = res.status === 200;
  const limited = res.status === 429;

  if (limited) {
    rateLimited.add(1);
  } else if (!served) {
    unexpectedStatus.add(1);
  }

  check(res, {
    'status is 200 (served) or 429 (correctly refused)': () => served || limited,
    '429 responses carry Retry-After': () => !limited || res.headers['Retry-After'] !== undefined,
    '429 responses carry a JSON error body, not a stack trace': () =>
      !limited || (res.headers['Content-Type'] || '').includes('application/json'),
  });
}
