'use client';

import posthog from 'posthog-js';
import {
  ANALYTICS_EVENT_NAMES,
  analyticsOptedOut,
  type AnalyticsEventMap,
  type AnalyticsEventName,
} from '@nidhi/core';

/**
 * Product analytics (docs/09 plane A).
 *
 * `track` is the only way an event leaves the app, and its signature is the
 * closed union from @nidhi/core, so a mistyped event name or a missing property
 * fails the build rather than producing a silent gap in a dashboard.
 *
 * Privacy stance, in the order it is enforced:
 *   - a session signalling Do Not Track or Global Privacy Control is never
 *     initialised at all, rather than tracked with a reduced payload;
 *   - no accounts, no identifiers, no PII, IP anonymised;
 *   - search records query *length* only, never the query text.
 */

let initialised = false;

export function initAnalytics(): void {
  if (initialised || typeof window === 'undefined') return;
  if (analyticsOptedOut()) return;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return; // Unconfigured, for example in local development.

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
    person_profiles: 'never',
    autocapture: false, // Only the declared taxonomy, nothing incidental.
    capture_pageview: false, // Routed through track('page_view') instead.
    capture_pageleave: false,
    disable_session_recording: true,
    ip: false,
    respect_dnt: true,
  });
  initialised = true;
}

export function track<Name extends AnalyticsEventName>(
  name: Name,
  properties: AnalyticsEventMap[Name],
): void {
  if (typeof window === 'undefined') return;
  if (analyticsOptedOut()) return;
  if (!initialised) return;
  posthog.capture(name, properties);
}

/** Exported for the methodology page, which publishes the taxonomy it collects. */
export const trackedEvents: readonly AnalyticsEventName[] = ANALYTICS_EVENT_NAMES;
