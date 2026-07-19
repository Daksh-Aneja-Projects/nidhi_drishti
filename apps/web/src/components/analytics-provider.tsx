'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { initAnalytics, track } from '@/lib/analytics';
import type { EntityType } from '@nidhi/core';

/**
 * Initialises analytics once and fires `page_view` on every route change.
 *
 * App Router client navigations do not reload the page, so a page view has to
 * be emitted from a route-aware effect rather than left to a script tag.
 */
export function AnalyticsProvider({
  entityType = 'none',
  entityId = null,
  fy,
}: {
  entityType?: EntityType | 'none';
  entityId?: string | null;
  fy: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    track('page_view', {
      route: pathname,
      entity_type: entityType,
      entity_id: entityId,
      fy,
    });
    // searchParams is included so an FY change through the query string counts
    // as a new view of that page.
  }, [pathname, searchParams, entityType, entityId, fy]);

  return null;
}
