import * as Sentry from '@sentry/nextjs';
import { isSentryEnabled, readSampleRate, scrubEvent } from '@/lib/observability';

/**
 * Edge runtime error reporting (docs/09 plane B). Loaded once at boot by
 * `instrumentation.ts`'s `register()` when `NEXT_RUNTIME === 'edge'` (the
 * middleware and any route explicitly opted into `export const runtime =
 * 'edge'`). Kept separate from sentry.server.config.ts because the edge
 * runtime cannot load the Node SDK's transport.
 *
 * Same posture as the other two entry points: no-op without a DSN, no PII,
 * every event scrubbed through the shared helper before it is sent.
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
