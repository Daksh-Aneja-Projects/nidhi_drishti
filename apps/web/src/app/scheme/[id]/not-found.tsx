import { Layers } from 'lucide-react';
import { EmptyState, PageHeader, PageShell } from '@/components/layout-primitives';
import { getStrings } from '@/lib/i18n-server';

/**
 * Shown when a scheme id is not in the records for the year being viewed.
 *
 * A scheme can be absent because it is reported under another name, because it
 * was merged into another programme, or because it simply is not broken out
 * separately that year. None of those are errors on the reader's part, so the
 * copy points onward to the full list rather than blaming the address.
 */
export default async function SchemeNotFound() {
  const strings = await getStrings();
  return (
    <PageShell>
      <PageHeader title={strings.scheme.notFoundTitle} />
      <EmptyState
        icon={Layers}
        title={strings.scheme.notFoundTitle}
        body={strings.scheme.notFoundBody}
        action={{ href: '/schemes', label: strings.schemes.title }}
      />
    </PageShell>
  );
}
