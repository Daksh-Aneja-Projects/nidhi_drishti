/**
 * Product analytics contract (docs/09 plane A).
 *
 * The event taxonomy is closed: `AnalyticsEvent` is a discriminated union, so a
 * typo in an event name or a missing property is a compile error rather than a
 * silently dropped event. Raw string event names anywhere else in the codebase
 * are forbidden; call the typed helpers in the web app's `analytics` module,
 * which are built on these types.
 *
 * Privacy stance: no PII, no user identifiers, no free-text search queries. Note
 * that `search_performed` carries the *length* of the query rather than the
 * query itself, which is deliberate.
 */

import type { AnomalyRuleId, EntityType, Severity } from './types';

export interface AnalyticsEventMap {
  page_view: {
    route: string;
    entity_type: EntityType | 'none';
    entity_id: string | null;
    fy: string;
  };
  provenance_opened: {
    metric: string;
    entity_id: string;
    source_id: string;
  };
  chart_interacted: {
    chart_id: string;
    action: 'hover_series' | 'toggle' | 'drill' | 'zoom' | 'table_fallback';
  };
  fy_changed: {
    from: string;
    to: string;
  };
  search_performed: {
    /** Length only. The query text is never sent. */
    query_len: number;
    results_count: number;
    clicked_rank: number | null;
  };
  compare_built: {
    entity_ids_count: number;
  };
  flag_card_opened: {
    rule_id: AnomalyRuleId;
    severity: Severity;
    entity_id: string;
  };
  verification_viewed: {
    entity_id: string;
    cached: boolean;
    report_age_days: number | null;
  };
  export_csv: {
    view_id: string;
    row_count: number;
  };
  share_card_generated: {
    entity_id: string;
    channel: string;
  };
  api_docs_viewed: {
    section: string;
  };
  error_reported: {
    route: string;
    category: string;
  };
}

export type AnalyticsEventName = keyof AnalyticsEventMap;

export type AnalyticsEvent = {
  [K in AnalyticsEventName]: { name: K; properties: AnalyticsEventMap[K] };
}[AnalyticsEventName];

/** The complete taxonomy, for the methodology page and for tests that assert coverage. */
export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEventName[] = [
  'page_view',
  'provenance_opened',
  'chart_interacted',
  'fy_changed',
  'search_performed',
  'compare_built',
  'flag_card_opened',
  'verification_viewed',
  'export_csv',
  'share_card_generated',
  'api_docs_viewed',
  'error_reported',
] as const;

/**
 * Do Not Track / Global Privacy Control check.
 *
 * docs/09 plane C: sessions signalling either get no analytics at all, not a
 * reduced set. Returns false in non-browser contexts so server code never
 * assumes consent.
 */
interface PrivacySignals {
  doNotTrack?: string | null;
  msDoNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}

export function analyticsOptedOut(): boolean {
  // Read the signals structurally off globalThis rather than through the DOM
  // globals, so this package stays usable from Node without pulling the DOM
  // lib into every consumer's typecheck.
  const scope = globalThis as { navigator?: PrivacySignals; doNotTrack?: string | null };
  const nav = scope.navigator;
  if (!nav) return true;
  const dnt = nav.doNotTrack ?? scope.doNotTrack ?? nav.msDoNotTrack;
  return dnt === '1' || dnt === 'yes' || nav.globalPrivacyControl === true;
}
