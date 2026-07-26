import { Map } from 'lucide-react';
import { EmptyState, PageHeader, PageShell } from '@/components/layout-primitives';
import { getStrings } from '@/lib/i18n-server';

/**
 * Shown when a state id matches nothing in the reference list.
 *
 * The reference list carries all 28 states and 8 union territories, so landing
 * here almost always means a mistyped or outdated address rather than a state
 * we have not ingested; those states have real pages that say what is missing.
 * The way forward is the full list.
 */
export default async function StateNotFound() {
  const strings = await getStrings();
  return (
    <PageShell>
      <PageHeader title={strings.states.notFoundTitle} />
      <EmptyState
        icon={Map}
        title={strings.states.notFoundTitle}
        body={strings.states.notFoundBody}
        action={{ href: '/states', label: strings.states.title }}
      />
    </PageShell>
  );
}
