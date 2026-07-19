import { FileQuestion } from 'lucide-react';
import { EmptyState, PageShell } from '@/components/layout-primitives';
import { strings } from '@/lib/strings';

/**
 * The 404. States what happened and offers the way back, with no apology voice
 * and no emoji (docs/10 copy rules).
 */

export default function NotFound() {
  return (
    <PageShell>
      <div className="mx-auto max-w-2xl py-16">
        <EmptyState
          icon={FileQuestion}
          title={strings.errors.notFound}
          body={strings.errors.notFoundBody}
          action={{ href: '/', label: strings.nav.overview }}
        />
      </div>
    </PageShell>
  );
}
