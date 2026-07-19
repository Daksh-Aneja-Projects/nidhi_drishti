import { listFlags, type FlagListOptions } from '@nidhi/db';
import { ANOMALY_RULES, type AnomalyRuleId, type EntityType, type Severity } from '@nidhi/core';
import {
  CACHE_SECONDS,
  enforceRateLimit,
  handleApiFailure,
  jsonEnvelope,
  readEnum,
  readLimit,
  resolveApiFy,
} from '@/lib/api';

/**
 * GET /api/v1/flags?fy=FY2026&rule=&severity=&entityType=&entityId=&limit=
 *
 * Signals that have cleared human review. Pending and rejected signals are not
 * reachable from here at any parameter combination (docs/05 A3).
 *
 * Each signal is returned with the rule that produced it, including the line
 * stating what the rule does not establish. That line is part of the payload
 * rather than a page decoration: a consumer republishing a signal without it
 * would be publishing an accusation we did not make.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RULES = [
  'march_rush',
  'under_utilization',
  'over_burn',
  'spend_no_tender',
  'revision_swing',
  'stat_outlier',
] as const satisfies readonly AnomalyRuleId[];

const SEVERITIES = ['info', 'notable', 'high'] as const satisfies readonly Severity[];
const ENTITY_TYPES = ['ministry', 'scheme', 'national'] as const satisfies readonly EntityType[];

export async function GET(request: Request) {
  try {
    const limited = await enforceRateLimit(request);
    if (limited.response) return limited.response;

    const url = new URL(request.url);
    const fy = await resolveApiFy(url);
    const options: FlagListOptions = {
      fy,
      ruleId: readEnum(url, 'rule', RULES),
      severity: readEnum(url, 'severity', SEVERITIES),
      entityType: readEnum(url, 'entityType', ENTITY_TYPES),
      entityId: url.searchParams.get('entityId') ?? undefined,
      limit: readLimit(url, 100, 200),
      // Not overridable. The public feed is approved signals only.
      status: 'approved',
    };

    const flags = await listFlags(options);
    const enriched = flags.map((flag) => ({
      ...flag,
      rule: ANOMALY_RULES[flag.ruleId],
    }));

    return await jsonEnvelope({ flags: enriched, count: enriched.length }, fy, {
      sMaxAge: CACHE_SECONDS.signals,
      headers: limited.headers,
    });
  } catch (error) {
    return handleApiFailure(error, 'GET /flags');
  }
}
