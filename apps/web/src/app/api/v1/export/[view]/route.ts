import {
  getMonthlySpend,
  listFlags,
  listMinistrySummaries,
  listSchemeSummaries,
} from '@nidhi/db';
import {
  ANOMALY_RULES,
  DEMO_DATA_NOTICE,
  FISCAL_STAGE_LABELS,
  csvAmount,
  toCsv,
  type AnomalyFlag,
  type CsvColumn,
  type EntityType,
  type FiscalYear,
  type MinistrySummary,
  type MonthlySpendPoint,
  type SchemeSummary,
} from '@nidhi/core';
import {
  ApiFailure,
  NATIONAL_ENTITY_ID,
  csvResponse,
  enforceRateLimit,
  handleApiFailure,
  loadExportSources,
  resolveApiFy,
  siteUrl,
} from '@/lib/api';
import { getDataMode } from '@/lib/site';

/**
 * GET /api/v1/export/{view}?fy=FY2026
 *
 * Comma separated values with the provenance preamble attached. The preamble is
 * not optional: a spreadsheet that leaves this site without its sources is the
 * artifact that gets quoted with no way to check it, and "Not reported" is
 * written out in words so that a missing figure cannot be summed as a zero.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIEWS = ['ministries', 'schemes', 'flags', 'monthly'] as const;
type ExportView = (typeof VIEWS)[number];

function isExportView(value: string): value is ExportView {
  return (VIEWS as readonly string[]).includes(value);
}

const MINISTRY_COLUMNS: ReadonlyArray<CsvColumn<MinistrySummary>> = [
  { key: 'fy', header: 'Financial year', value: (row) => row.fy },
  { key: 'ministry_id', header: 'Ministry id', value: (row) => row.ministryId },
  { key: 'name', header: 'Ministry', value: (row) => row.name },
  { key: 'sector', header: 'Sector', value: (row) => row.sector },
  { key: 'be', header: `${FISCAL_STAGE_LABELS.BE} (INR crore)`, value: (row) => csvAmount(row.be) },
  { key: 're', header: `${FISCAL_STAGE_LABELS.RE} (INR crore)`, value: (row) => csvAmount(row.re) },
  {
    key: 'supplementary',
    header: `${FISCAL_STAGE_LABELS.SUPPLEMENTARY} (INR crore)`,
    value: (row) => csvAmount(row.supplementary),
  },
  {
    key: 'current_authority',
    header: 'Current spending authority (INR crore)',
    value: (row) => csvAmount(row.currentAuthority),
  },
  {
    key: 'expenditure_to_date',
    header: `${FISCAL_STAGE_LABELS.EXPENDITURE} to date (INR crore)`,
    value: (row) => csvAmount(row.expenditureToDate),
  },
  { key: 'expenditure_as_of', header: 'Expenditure as of', value: (row) => row.expenditureAsOf },
  { key: 'balance', header: 'Balance (INR crore)', value: (row) => csvAmount(row.balance) },
  {
    key: 'revenue_expenditure',
    header: 'Revenue expenditure (INR crore)',
    value: (row) => csvAmount(row.revenueExpenditure),
  },
  {
    key: 'capital_expenditure',
    header: 'Capital expenditure (INR crore)',
    value: (row) => csvAmount(row.capitalExpenditure),
  },
  { key: 'pct_spent', header: 'Share of authority spent (%)', value: (row) => csvAmount(row.burn.pctSpent) },
  { key: 'pct_fy_elapsed', header: 'Share of year elapsed (%)', value: (row) => row.burn.pctFyElapsed },
  { key: 'burn_ratio', header: 'Pace against the calendar', value: (row) => csvAmount(row.burn.burnRatio) },
  { key: 'open_flags', header: 'Open signals', value: (row) => row.openFlagCount },
];

const SCHEME_COLUMNS: ReadonlyArray<CsvColumn<SchemeSummary>> = [
  { key: 'fy', header: 'Financial year', value: (row) => row.fy },
  { key: 'scheme_id', header: 'Scheme id', value: (row) => row.schemeId },
  { key: 'name', header: 'Scheme', value: (row) => row.name },
  { key: 'ministry_id', header: 'Ministry id', value: (row) => row.ministryId },
  { key: 'ministry_name', header: 'Ministry', value: (row) => row.ministryName },
  { key: 'scheme_type', header: 'Scheme type', value: (row) => row.schemeType },
  { key: 'allocation', header: 'Allocation (INR crore)', value: (row) => csvAmount(row.allocation) },
  {
    key: 'released',
    header: `${FISCAL_STAGE_LABELS.RELEASE} (INR crore)`,
    value: (row) => csvAmount(row.released),
  },
  {
    key: 'utilized',
    header: `${FISCAL_STAGE_LABELS.UTILIZATION} (INR crore)`,
    value: (row) => csvAmount(row.utilized),
  },
  { key: 'utilization_pct', header: 'Utilisation (%)', value: (row) => csvAmount(row.utilizationPct) },
  { key: 'tender_count', header: 'Matched tenders', value: (row) => row.tenderCount },
  { key: 'tender_value', header: 'Matched tender value (INR crore)', value: (row) => csvAmount(row.tenderValue) },
];

const FLAG_COLUMNS: ReadonlyArray<CsvColumn<AnomalyFlag>> = [
  { key: 'flag_id', header: 'Signal id', value: (row) => row.flagId },
  { key: 'fy', header: 'Financial year', value: (row) => row.fy },
  { key: 'rule_id', header: 'Rule id', value: (row) => row.ruleId },
  { key: 'rule_label', header: 'Rule', value: (row) => ANOMALY_RULES[row.ruleId].label },
  { key: 'entity_type', header: 'Entity type', value: (row) => row.entityType },
  { key: 'entity_id', header: 'Entity id', value: (row) => row.entityId },
  { key: 'entity_name', header: 'Entity', value: (row) => row.entityName },
  { key: 'severity', header: 'Severity', value: (row) => row.severity },
  { key: 'explanation', header: 'Explanation', value: (row) => row.explanation },
  {
    // Carried in the file itself, so a republished row cannot lose the caveat.
    key: 'does_not_establish',
    header: 'What this does not establish',
    value: (row) => ANOMALY_RULES[row.ruleId].doesNotProve,
  },
  { key: 'created_at', header: 'Raised at', value: (row) => row.createdAt },
  { key: 'evidence_count', header: 'Evidence items', value: (row) => row.evidence.length },
];

const MONTHLY_COLUMNS: ReadonlyArray<CsvColumn<MonthlySpendPoint>> = [
  { key: 'period_start', header: 'Period start', value: (row) => row.periodStart },
  { key: 'period_end', header: 'Period end', value: (row) => row.periodEnd },
  { key: 'fiscal_month_index', header: 'Month of the financial year', value: (row) => row.fiscalMonthIndex },
  { key: 'label', header: 'Month', value: (row) => row.label },
  { key: 'cumulative', header: 'Cumulative expenditure (INR crore)', value: (row) => csvAmount(row.cumulative) },
  { key: 'monthly', header: 'Expenditure in month (INR crore)', value: (row) => csvAmount(row.monthly) },
  { key: 'is_provisional', header: 'Provisional', value: (row) => row.isProvisional },
  { key: 'is_revision_artifact', header: 'Negative after revision', value: (row) => row.isRevisionArtifact },
];

const TITLES: Record<ExportView, string> = {
  ministries: 'Ministry allocation and expenditure',
  schemes: 'Scheme allocation, releases and utilisation',
  flags: 'Published signals',
  monthly: 'Monthly expenditure',
};

const ENTITY_TYPES: readonly EntityType[] = ['ministry', 'scheme', 'national'];

async function renderView(view: ExportView, fy: FiscalYear, url: URL): Promise<string> {
  const [sources, dataMode] = await Promise.all([loadExportSources(), safeDataMode()]);
  const preamble = {
    title: `${TITLES[view]}, ${fy}`,
    fy,
    generatedAt: new Date().toISOString(),
    siteUrl,
    sources,
    notice: dataMode === 'demo' ? DEMO_DATA_NOTICE : undefined,
  };

  switch (view) {
    case 'ministries': {
      const rows = await listMinistrySummaries(fy, { limit: 500 });
      return toCsv(rows, MINISTRY_COLUMNS, preamble);
    }
    case 'schemes': {
      const rows = await listSchemeSummaries(fy, { limit: 300 });
      return toCsv(rows, SCHEME_COLUMNS, preamble);
    }
    case 'flags': {
      const rows = await listFlags({ fy, limit: 200 });
      return toCsv(rows, FLAG_COLUMNS, preamble);
    }
    case 'monthly': {
      const entityType = url.searchParams.get('entityType') ?? 'national';
      if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) {
        throw new ApiFailure(
          400,
          'invalid_request',
          `The entityType parameter must be one of: ${ENTITY_TYPES.join(', ')}.`,
        );
      }
      const entityId =
        url.searchParams.get('entityId') ?? (entityType === 'national' ? NATIONAL_ENTITY_ID : '');
      if (!entityId) {
        throw new ApiFailure(
          400,
          'invalid_request',
          'An entityId is required when exporting the monthly series for a ministry or a scheme.',
        );
      }
      const rows = await getMonthlySpend(entityType as EntityType, entityId, fy);
      return toCsv(rows, MONTHLY_COLUMNS, {
        ...preamble,
        title: `${TITLES[view]}, ${entityType} ${entityId}, ${fy}`,
      });
    }
  }
}

async function safeDataMode() {
  try {
    return await getDataMode();
  } catch {
    return 'live' as const;
  }
}

export async function GET(request: Request, context: { params: Promise<{ view: string }> }) {
  try {
    const limited = await enforceRateLimit(request);
    if (limited.response) return limited.response;

    const { view } = await context.params;
    if (!isExportView(view)) {
      throw new ApiFailure(
        400,
        'unknown_view',
        `There is no export called "${view}". The available exports are: ${VIEWS.join(', ')}.`,
      );
    }

    const url = new URL(request.url);
    const fy = await resolveApiFy(url);
    const body = await renderView(view, fy, url);

    return csvResponse(body, `nidhi-drishti-${view}-${fy.toLowerCase()}.csv`, limited.headers);
  } catch (error) {
    return handleApiFailure(error, 'GET /export/{view}');
  }
}
