import { FileQuestion } from 'lucide-react';
import { EmptyState, PageShell } from '@/components/layout-primitives';
import { getStrings } from '@/lib/i18n-server';

/**
 * The 404. States what happened and offers the way back, with no apology voice
 * and no emoji (docs/10 copy rules).
 */

export default async function NotFound() {
  const strings = await getStrings();
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
