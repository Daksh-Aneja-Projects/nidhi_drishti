import { Landmark } from 'lucide-react';
import { EmptyState, PageShell } from '@/components/layout-primitives';
import { getStrings } from '@/lib/i18n-server';

/**
 * Shown when a ministry has no record in the selected financial year.
 *
 * Deliberately not phrased as an error: a ministry that carried a demand last
 * year and none this year is a real fact about the budget, not a broken link.
 */
export default async function MinistryNotFound() {
  const strings = await getStrings();
  return (
    <PageShell>
      <EmptyState
        icon={Landmark}
        title={strings.ministry.notFoundTitle}
        body={strings.ministry.notFoundBody}
        action={{ href: '/ministries', label: strings.ministry.backToList }}
      />
    </PageShell>
  );
}
