import * as Sentry from '@sentry/nextjs';
import { isSentryEnabled, readSampleRate, scrubEvent } from '@/lib/observability';

/**
 * Node runtime error reporting (docs/09 plane B). Loaded once at boot by
 * `instrumentation.ts`'s `register()` when `NEXT_RUNTIME === 'nodejs'`: this
 * is the runtime that talks to Postgres and Redis, so it is the one most
 * likely to have a secret sitting in a caught exception's message.
 *
 * No-op when SENTRY_DSN is unset, which keeps local development and CI silent.
 * `sendDefaultPii: false` and `scrubEvent` mirror the client config exactly;
 * see apps/web/src/lib/observability.ts for the shared rule.
 */
const dsn = process.env.SENTRY_DSN;

if (isSentryEnabled(dsn)) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: readSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.05),
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  });
}
