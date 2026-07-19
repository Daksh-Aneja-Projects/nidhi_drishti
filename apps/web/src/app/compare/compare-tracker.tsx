'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics';

/**
 * Fires `compare_built` once a comparison has entities in it.
 *
 * The comparison itself renders on the server; this is the one client sliver
 * that exists because the analytics module is a browser module. It carries a
 * count and nothing else, in keeping with the taxonomy in docs/09.
 */
export function CompareTracker({ count }: { count: number }) {
  useEffect(() => {
    if (count > 0) track('compare_built', { entity_ids_count: count });
  }, [count]);
  return null;
}
