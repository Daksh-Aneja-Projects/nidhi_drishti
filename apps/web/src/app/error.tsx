'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import { EmptyState, PageShell } from '@/components/layout-primitives';
import { strings } from '@/lib/strings';

/**
 * The route error boundary. Next requires this to be a client component.
 *
 * The thrown error is logged rather than rendered: a database message can carry
 * a host and a user, and a reader can do nothing with a stack trace. What they
 * get is what happened, what to do next, and a way to report it.
 */

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[web] route error', error);
  }, [error]);

  return (
    <PageShell>
      <div className="mx-auto max-w-2xl py-16">
        <EmptyState
          icon={TriangleAlert}
          title={strings.errors.generic}
          body={strings.errors.genericBody}
          action={{ href: '/corrections', label: strings.errors.reportError }}
        />
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={reset}
            className="border-b border-[color:var(--color-behind)] pb-0.5 text-[13px] font-medium text-[color:var(--color-behind)]"
          >
            {strings.errors.retry}
          </button>
        </div>
      </div>
    </PageShell>
  );
}
