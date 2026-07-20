import * as Sentry from '@sentry/nextjs';
import { analyticsOptedOut } from '@nidhi/core';
import { isSentryEnabled, readSampleRate, scrubEvent } from '@/lib/observability';

/**
 * Browser-side error reporting (docs/09 plane B). Loaded automatically by the
 * Sentry Next.js build plugin (wired through `withSentryConfig` in
 * next.config.ts) as the client entry's first import.
 *
 * Three gates, all of which must pass before a single byte leaves the browser:
 *   1. NEXT_PUBLIC_SENTRY_DSN is set. Local dev and CI leave it empty, so this
 *      file is a no-op there, same as the product-analytics init in
 *      src/lib/analytics.ts.
 *   2. The session has not signalled Do Not Track / Global Privacy Control
 *      (docs/09 plane C, docs/08 section 4). The same signal that turns off
 *      PostHog turns off Sentry: a user opting out of tracking should not
 *      still be sending stack traces and page URLs to a different vendor.
 *   3. Every event passes through `scrubEvent`, which strips connection
 *      strings and API keys wherever they appear in the payload.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (isSentryEnabled(dsn) && !analyticsOptedOut()) {
  Sentry.init({
    dsn,
    // No PII, ever (CLAUDE.md, docs/08 section 4): no user context, no cookies,
    // no IP address attached to events.
    sendDefaultPii: false,
    tracesSampleRate: readSampleRate(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE, 0.05),
    // Session replay is off outright rather than sampled to zero: the
    // integration itself would otherwise buffer DOM snapshots in memory for a
    // product with no accounts and a hard "no PII" rule.
    integrations: [],
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  });
}
