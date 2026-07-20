import * as Sentry from '@sentry/nextjs';

/**
 * Next 15 instrumentation hook (docs/09 plane B).
 *
 * `register()` runs once per server runtime at process boot, before any
 * request is handled, and is the only supported place to load a
 * runtime-specific Sentry config: sentry.server.config.ts touches Node APIs
 * the edge runtime does not have, so importing the wrong one at the wrong
 * time is a startup crash, not a warning. The browser config is not loaded
 * here at all; it is injected into the client bundle by the Sentry webpack
 * plugin (see next.config.ts).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Server-side rendering and route-handler errors that Next catches itself
 * (docs/09: "never surfaced in UI" cuts both ways -- an error page must not
 * show a stack trace, but the failure still has to reach Sentry). A no-op
 * when Sentry was never initialised, so this is safe to export unconditionally.
 */
export const onRequestError = Sentry.captureRequestError;
