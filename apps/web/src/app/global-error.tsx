'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';
import { TriangleAlert } from 'lucide-react';
import { EmptyState, PageShell } from '@/components/layout-primitives';
import { strings } from '@/lib/strings';

/**
 * The root-layout error boundary (Next 15 file convention).
 *
 * `src/app/error.tsx` only catches errors thrown while rendering a route
 * segment; an error thrown by the root layout itself (fonts, the freshness
 * bar, the header) skips it entirely and would otherwise reach the user as a
 * blank page. This file has to render its own <html>/<body> because, when it
 * is active, the root layout has failed and is not there to provide them.
 *
 * `Sentry.captureException` is called explicitly rather than relying on
 * `onRequestError` in instrumentation.ts: that hook covers server-rendering
 * and route-handler failures, not an error boundary mounted client-side after
 * hydration. A no-op when Sentry was never initialised (docs/09: no DSN, no
 * traffic), same as every other call site in this app.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[web] root layout error', error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en-IN">
      <body>
        <PageShell>
          <div className="mx-auto max-w-2xl py-16">
            <EmptyState
              icon={TriangleAlert}
              title={strings.errors.generic}
              body={strings.errors.genericBody}
              action={{ href: '/', label: strings.nav.overview }}
            />
          </div>
        </PageShell>
      </body>
    </html>
  );
}
