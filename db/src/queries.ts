/**
 * Data access for the web app and the public API.
 *
 * Every function here reads materialised views or canonical tables and never
 * staging (docs/02 rule 4), and every one maps raw NUMERIC strings through
 * `parseAmountCr`, so an absent figure arrives at the UI as NOT_REPORTED rather
 * than as a zero that would read as "they spent nothing".
 */

import {
  NOT_REPORTED,
  parseAmountCr,
  type Amount,
  type AnomalyFlag,
  type AnomalyRuleId,
  type Confidence,
  type EntityType,
  type EvidenceItem,
  type EvidenceKind,
  type FiscalYear,
  type FlagStatus,
  type MinistrySummary,
  type MonthlySpendPoint,
  type NationalSummary,
  type PipelineRun,
  type Provenance,
  type SchemeSummary,
  type SchemeType,
  type Severity,
  type SourceFreshness,
  type SourceRegistryEntry,
  type Tender,
  type VerificationReport,
} from '@nidhi/core';
import { query, queryOne } from './client';

/* ------------------------------------------------------------------ *
 * Row shapes and mappers
 * ------------------------------------------------------------------ */

/** `pg` hands back NUMERIC as a string to preserve precision. */
type Numeric = string | null;

interface ProvenanceRow {
  source_record_id: number;
  source_id: string;
  source_name: string;
  url: string | null;
  artifact_key: string | null;
  document_date: string | null;
  fetched_at: Date;
  extraction_method: string | null;
  is_provisional: boolean;
}

function mapProvenance(row: ProvenanceRow): Provenance {
  return {
    sourceRecordId: Number(row.source_record_id),
    sourceId: row.source_id,
    sourceName: row.source_name,
    url: row.url,
    artifactKey: row.artifact_key,
    documentDate: row.document_date,
    fetchedAt: row.fetched_at.toISOString(),
    extractionMethod: (row.extraction_method ?? 'manual_entry') as Provenance['extractionMethod'],
    isProvisional: row.is_provisional,
  };
}

/**
 * Fetch provenance for a set of source_record ids in one round trip.
 *
 * A ministry page shows dozens of figures. Resolving provenance per figure
 * would turn one page render into dozens of queries, and the usual result of
 * that is someone "optimising" by dropping the provenance, which is the one
 * thing this product cannot trade away.
 */
export async function getProvenanceMap(
  sourceRecordIds: ReadonlyArray<number | null | undefined>,
): Promise<Map<number, Provenance>> {
  const ids = [...new Set(sourceRecordIds.filter((id): id is number => typeof id === 'number'))];
  if (ids.length === 0) return new Map();
  const rows = await query<ProvenanceRow>(
    `SELECT source_record_id, source_id, source_name, url, artifact_key,
            document_date, fetched_at, extraction_method, is_provisional
     FROM v_provenance
     WHERE source_record_id = ANY($1::BIGINT[])`,
    [ids],
  );
  return new Map(rows.map((row) => [Number(row.source_record_id), mapProvenance(row)]));
}

/* ------------------------------------------------------------------ *
 * Fiscal years
 * ------------------------------------------------------------------ */

/**
 * Fiscal years that actually have data, newest first.
 *
 * Driven by the facts present rather than by the fiscal_year reference table,
 * so the FY selector never offers a year that would render an empty page.
 */
export async function listFiscalYearsWithData(): Promise<FiscalYear[]> {
  const rows = await query<{ fy: string }>(
    `SELECT DISTINCT fy FROM fiscal_fact ORDER BY fy DESC`,
  );
  return rows.map((row) => row.fy as FiscalYear);
}

/** The FY the site defaults to: the most recent one with any expenditure reported. */
export async function getDefaultFiscalYear(): Promise<FiscalYear | null> {
  const row = await queryOne<{ fy: string }>(
    `SELECT fy FROM fiscal_fact
     WHERE stage = 'EXPENDITURE'
     ORDER BY fy DESC
     LIMIT 1`,
  );
  if (row) return row.fy as FiscalYear;
  const fallback = await queryOne<{ fy: string }>(
    `SELECT fy FROM fiscal_fact ORDER BY fy DESC LIMIT 1`,
  );
  return fallback ? (fallback.fy as FiscalYear) : null;
}

/* ------------------------------------------------------------------ *
 * National
 * ------------------------------------------------------------------ */

interface NationalRow {
  fy: string;
  be: Numeric;
  re: Numeric;
  supplementary: Numeric;
  current_authority: Numeric;
  expenditure_to_date: Numeric;
  expenditure_as_of: string | null;
  balance: Numeric;
  pct_spent: Numeric;
  pct_fy_elapsed: Numeric;
  burn_ratio: Numeric;
  ministry_count: number;
  ministry_sum_residual: Numeric;
  authority_source_record_id: number | null;
  expenditure_source_record_id: number | null;
  has_illustrative_source: boolean;
}

export async function getNationalSummary(fy: string): Promise<NationalSummary | null> {
  const row = await queryOne<NationalRow>(`SELECT * FROM mv_national_summary WHERE fy = $1`, [fy]);
  if (!row) return null;
  const provenance = await getProvenanceMap([
    row.authority_source_record_id,
    row.expenditure_source_record_id,
  ]);
  return {
    fy: row.fy as FiscalYear,
    be: parseAmountCr(row.be),
    re: parseAmountCr(row.re),
    supplementary: parseAmountCr(row.supplementary),
    currentAuthority: parseAmountCr(row.current_authority),
    expenditureToDate: parseAmountCr(row.expenditure_to_date),
    expenditureAsOf: row.expenditure_as_of,
    balance: parseAmountCr(row.balance),
    burn: {
      pctSpent: parseAmountCr(row.pct_spent),
      // pct_fy_elapsed is a plain number in the domain type because it is
      // always computable from the calendar; a missing expenditure date makes
      // the whole comparison meaningless, so it collapses to zero and the
      // burn ratio stays NOT_REPORTED.
      pctFyElapsed: row.pct_fy_elapsed === null ? 0 : Number(row.pct_fy_elapsed),
      burnRatio: parseAmountCr(row.burn_ratio),
    },
    ministryCount: Number(row.ministry_count),
    ministrySumResidual: parseAmountCr(row.ministry_sum_residual),
    provenance: {
      authority: provenance.get(Number(row.authority_source_record_id)) ?? null,
      expenditure: provenance.get(Number(row.expenditure_source_record_id)) ?? null,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Ministries
 * ------------------------------------------------------------------ */

interface MinistryRow {
  fy: string;
  ministry_id: string;
  name: string;
  sector: string | null;
  be: Numeric;
  re: Numeric;
  supplementary: Numeric;
  current_authority: Numeric;
  expenditure_to_date: Numeric;
  expenditure_as_of: string | null;
  revenue_expenditure: Numeric;
  capital_expenditure: Numeric;
  balance: Numeric;
  pct_spent: Numeric;
  pct_fy_elapsed: Numeric;
  burn_ratio: Numeric;
  authority_source_record_id: number | null;
  expenditure_source_record_id: number | null;
  has_illustrative_source: boolean;
  open_flag_count: number;
}

function mapMinistry(row: MinistryRow, provenance: Map<number, Provenance>): MinistrySummary {
  return {
    fy: row.fy as FiscalYear,
    ministryId: row.ministry_id,
    name: row.name,
    sector: row.sector,
    be: parseAmountCr(row.be),
    re: parseAmountCr(row.re),
    supplementary: parseAmountCr(row.supplementary),
    currentAuthority: parseAmountCr(row.current_authority),
    expenditureToDate: parseAmountCr(row.expenditure_to_date),
    expenditureAsOf: row.expenditure_as_of,
    balance: parseAmountCr(row.balance),
    revenueExpenditure: parseAmountCr(row.revenue_expenditure),
    capitalExpenditure: parseAmountCr(row.capital_expenditure),
    burn: {
      pctSpent: parseAmountCr(row.pct_spent),
      pctFyElapsed: row.pct_fy_elapsed === null ? 0 : Number(row.pct_fy_elapsed),
      burnRatio: parseAmountCr(row.burn_ratio),
    },
    openFlagCount: Number(row.open_flag_count),
    provenance: {
      authority: provenance.get(Number(row.authority_source_record_id)) ?? null,
      expenditure: provenance.get(Number(row.expenditure_source_record_id)) ?? null,
    },
  };
}

export interface MinistryListOptions {
  sector?: string;
  /** Ordering for the overview tables. */
  orderBy?: 'allocation' | 'burn_asc' | 'burn_desc' | 'name' | 'balance';
  limit?: number;
}

export async function listMinistrySummaries(
  fy: string,
  options: MinistryListOptions = {},
): Promise<MinistrySummary[]> {
  const order =
    {
      // NULLS LAST throughout: an entity with no reported figure belongs at the
      // bottom of a ranking, not at the top of one sorted ascending.
      allocation: 'current_authority DESC NULLS LAST',
      burn_asc: 'burn_ratio ASC NULLS LAST',
      burn_desc: 'burn_ratio DESC NULLS LAST',
      balance: 'balance DESC NULLS LAST',
      name: 'name ASC',
    }[options.orderBy ?? 'allocation'] ?? 'current_authority DESC NULLS LAST';

  const rows = await query<MinistryRow>(
    `SELECT * FROM mv_ministry_summary
     WHERE fy = $1 AND ($2::TEXT IS NULL OR sector = $2)
     ORDER BY ${order}
     LIMIT $3`,
    [fy, options.sector ?? null, options.limit ?? 500],
  );
  const provenance = await getProvenanceMap(
    rows.flatMap((row) => [row.authority_source_record_id, row.expenditure_source_record_id]),
  );
  return rows.map((row) => mapMinistry(row, provenance));
}

export async function getMinistrySummary(
  fy: string,
  ministryId: string,
): Promise<MinistrySummary | null> {
  const row = await queryOne<MinistryRow>(
    `SELECT * FROM mv_ministry_summary WHERE fy = $1 AND ministry_id = $2`,
    [fy, ministryId],
  );
  if (!row) return null;
  const provenance = await getProvenanceMap([
    row.authority_source_record_id,
    row.expenditure_source_record_id,
  ]);
  return mapMinistry(row, provenance);
}

/** Allocation across five fiscal years, for the year-on-year trend. */
export async function getMinistryAllocationHistory(
  ministryId: string,
  fiscalYears: readonly string[],
): Promise<Array<{ fy: FiscalYear; be: Amount; re: Amount; expenditure: Amount }>> {
  const rows = await query<{
    fy: string;
    be: Numeric;
    re: Numeric;
    expenditure_to_date: Numeric;
  }>(
    `SELECT fy, be, re, expenditure_to_date
     FROM mv_ministry_summary
     WHERE ministry_id = $1 AND fy = ANY($2::TEXT[])
     ORDER BY fy`,
    [ministryId, fiscalYears],
  );
  return rows.map((row) => ({
    fy: row.fy as FiscalYear,
    be: parseAmountCr(row.be),
    re: parseAmountCr(row.re),
    expenditure: parseAmountCr(row.expenditure_to_date),
  }));
}

/** Distinct sectors present in a fiscal year, for filters and the treemap. */
export async function listSectors(fy: string): Promise<string[]> {
  const rows = await query<{ sector: string }>(
    `SELECT DISTINCT sector FROM mv_ministry_summary
     WHERE fy = $1 AND sector IS NOT NULL ORDER BY sector`,
    [fy],
  );
  return rows.map((row) => row.sector);
}

/* ------------------------------------------------------------------ *
 * Monthly spend
 * ------------------------------------------------------------------ */

interface MonthlyRow {
  fy: string;
  period_start: string;
  period_end: string;
  fiscal_month_index: number;
  cumulative_amount: Numeric;
  monthly_amount: Numeric;
  is_revision_artifact: boolean;
  is_provisional: boolean;
  source_record_id: number | null;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function monthLabel(isoDate: string): string {
  const [year, month] = isoDate.split('-');
  const index = Number(month) - 1;
  return `${MONTH_NAMES[index] ?? month} ${year}`;
}

export async function getMonthlySpend(
  entityType: EntityType,
  entityId: string,
  fy: string,
): Promise<MonthlySpendPoint[]> {
  const rows = await query<MonthlyRow>(
    `SELECT * FROM mv_monthly_spend
     WHERE entity_type = $1 AND entity_id = $2 AND fy = $3
     ORDER BY fiscal_month_index`,
    [entityType, entityId, fy],
  );
  const provenance = await getProvenanceMap(rows.map((row) => row.source_record_id));
  return rows.map((row) => ({
    periodStart: row.period_start,
    periodEnd: row.period_end,
    fiscalMonthIndex: row.fiscal_month_index,
    label: monthLabel(row.period_end),
    cumulative: parseAmountCr(row.cumulative_amount),
    monthly: parseAmountCr(row.monthly_amount),
    isProvisional: row.is_provisional,
    isRevisionArtifact: row.is_revision_artifact,
    provenance: provenance.get(Number(row.source_record_id)) ?? null,
  }));
}

/* ------------------------------------------------------------------ *
 * Schemes
 * ------------------------------------------------------------------ */

interface SchemeRow {
  fy: string;
  scheme_id: string;
  name: string;
  ministry_id: string | null;
  ministry_name: string | null;
  scheme_type: string | null;
  allocation: Numeric;
  released: Numeric;
  utilized: Numeric;
  utilization_pct: Numeric;
  tender_count: number;
  tender_value: Numeric;
  allocation_source_record_id: number | null;
  release_source_record_id: number | null;
  utilization_source_record_id: number | null;
  has_illustrative_source: boolean;
}

function mapScheme(row: SchemeRow, provenance: Map<number, Provenance>): SchemeSummary {
  return {
    fy: row.fy as FiscalYear,
    schemeId: row.scheme_id,
    name: row.name,
    ministryId: row.ministry_id,
    ministryName: row.ministry_name,
    schemeType: row.scheme_type as SchemeType | null,
    allocation: parseAmountCr(row.allocation),
    released: parseAmountCr(row.released),
    utilized: parseAmountCr(row.utilized),
    utilizationPct: parseAmountCr(row.utilization_pct),
    tenderCount: Number(row.tender_count),
    tenderValue: parseAmountCr(row.tender_value),
    provenance: {
      allocation: provenance.get(Number(row.allocation_source_record_id)) ?? null,
      released: provenance.get(Number(row.release_source_record_id)) ?? null,
      utilized: provenance.get(Number(row.utilization_source_record_id)) ?? null,
    },
  };
}

export interface SchemeListOptions {
  ministryId?: string;
  schemeType?: SchemeType;
  orderBy?: 'allocation' | 'utilization_asc' | 'name';
  limit?: number;
}

export async function listSchemeSummaries(
  fy: string,
  options: SchemeListOptions = {},
): Promise<SchemeSummary[]> {
  const order =
    {
      allocation: 'allocation DESC NULLS LAST',
      utilization_asc: 'utilization_pct ASC NULLS LAST',
      name: 'name ASC',
    }[options.orderBy ?? 'allocation'] ?? 'allocation DESC NULLS LAST';

  const rows = await query<SchemeRow>(
    `SELECT * FROM mv_scheme_summary
     WHERE fy = $1
       AND ($2::TEXT IS NULL OR ministry_id = $2)
       AND ($3::TEXT IS NULL OR scheme_type = $3)
     ORDER BY ${order}
     LIMIT $4`,
    [fy, options.ministryId ?? null, options.schemeType ?? null, options.limit ?? 300],
  );
  const provenance = await getProvenanceMap(
    rows.flatMap((row) => [
      row.allocation_source_record_id,
      row.release_source_record_id,
      row.utilization_source_record_id,
    ]),
  );
  return rows.map((row) => mapScheme(row, provenance));
}

export async function getSchemeSummary(fy: string, schemeId: string): Promise<SchemeSummary | null> {
  const row = await queryOne<SchemeRow>(
    `SELECT * FROM mv_scheme_summary WHERE fy = $1 AND scheme_id = $2`,
    [fy, schemeId],
  );
  if (!row) return null;
  const provenance = await getProvenanceMap([
    row.allocation_source_record_id,
    row.release_source_record_id,
    row.utilization_source_record_id,
  ]);
  return mapScheme(row, provenance);
}

/* ------------------------------------------------------------------ *
 * Verification layer
 * ------------------------------------------------------------------ */

interface TenderRow {
  tender_id: string;
  title: string;
  org_raw: string;
  ministry_id: string | null;
  scheme_id: string | null;
  value_inr_cr: Numeric;
  status: string;
  published_date: string | null;
  award_date: string | null;
  url: string | null;
  match_confidence: string | null;
}

export interface TenderListOptions {
  ministryId?: string;
  schemeId?: string;
  since?: string;
  limit?: number;
}

export async function listTenders(options: TenderListOptions = {}): Promise<Tender[]> {
  const rows = await query<TenderRow>(
    `SELECT tender_id, title, org_raw, ministry_id, scheme_id, value_inr_cr,
            status, published_date, award_date, url, match_confidence
     FROM tender
     WHERE ($1::TEXT IS NULL OR ministry_id = $1)
       AND ($2::TEXT IS NULL OR scheme_id = $2)
       AND ($3::DATE IS NULL OR published_date >= $3)
     ORDER BY published_date DESC NULLS LAST
     LIMIT $4`,
    [options.ministryId ?? null, options.schemeId ?? null, options.since ?? null, options.limit ?? 50],
  );
  return rows.map((row) => ({
    tenderId: row.tender_id,
    title: row.title,
    orgRaw: row.org_raw,
    ministryId: row.ministry_id,
    schemeId: row.scheme_id,
    valueInrCr: parseAmountCr(row.value_inr_cr),
    status: row.status as Tender['status'],
    publishedDate: row.published_date,
    awardDate: row.award_date,
    url: row.url,
    matchConfidence: row.match_confidence as Confidence | null,
  }));
}

interface EvidenceRow {
  evidence_id: number;
  kind: string;
  title: string;
  url: string | null;
  published_date: string | null;
  ministry_id: string | null;
  scheme_id: string | null;
  summary: string | null;
}

export interface EvidenceListOptions {
  ministryId?: string;
  schemeId?: string;
  kinds?: readonly EvidenceKind[];
  since?: string;
  limit?: number;
}

export async function listEvidence(options: EvidenceListOptions = {}): Promise<EvidenceItem[]> {
  const rows = await query<EvidenceRow>(
    `SELECT evidence_id, kind, title, url, published_date, ministry_id, scheme_id, summary
     FROM evidence_item
     WHERE ($1::TEXT IS NULL OR ministry_id = $1)
       AND ($2::TEXT IS NULL OR scheme_id = $2)
       AND ($3::TEXT[] IS NULL OR kind = ANY($3))
       AND ($4::DATE IS NULL OR published_date >= $4)
     ORDER BY published_date DESC NULLS LAST
     LIMIT $5`,
    [
      options.ministryId ?? null,
      options.schemeId ?? null,
      options.kinds && options.kinds.length > 0 ? options.kinds : null,
      options.since ?? null,
      options.limit ?? 50,
    ],
  );
  return rows.map((row) => ({
    evidenceId: Number(row.evidence_id),
    kind: row.kind as EvidenceKind,
    title: row.title,
    url: row.url,
    publishedDate: row.published_date,
    ministryId: row.ministry_id,
    schemeId: row.scheme_id,
    summary: row.summary,
  }));
}

interface FlagRow {
  flag_id: number;
  rule_id: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  fy: string;
  severity: string;
  metric: Record<string, unknown>;
  explanation: string;
  status: string;
  created_at: Date;
}

export interface FlagListOptions {
  fy?: string;
  ruleId?: AnomalyRuleId;
  severity?: Severity;
  entityType?: EntityType;
  entityId?: string;
  /**
   * Defaults to approved only. The public feed must never show a flag that has
   * not cleared human review (docs/05 A3), so callers have to ask for other
   * statuses explicitly and only the admin surface does.
   */
  status?: FlagStatus | 'all';
  limit?: number;
}

export async function listFlags(options: FlagListOptions = {}): Promise<AnomalyFlag[]> {
  const status = options.status ?? 'approved';
  const rows = await query<FlagRow>(
    `SELECT f.flag_id, f.rule_id, f.entity_type, f.entity_id,
            COALESCE(m.name, s.name, f.entity_id) AS entity_name,
            f.fy, f.severity, f.metric, f.explanation, f.status, f.created_at
     FROM anomaly_flag f
     LEFT JOIN ministry m ON f.entity_type = 'ministry' AND m.ministry_id = f.entity_id
     LEFT JOIN scheme   s ON f.entity_type = 'scheme'   AND s.scheme_id   = f.entity_id
     WHERE ($1::TEXT IS NULL OR f.fy = $1)
       AND ($2::TEXT IS NULL OR f.rule_id = $2)
       AND ($3::TEXT IS NULL OR f.severity = $3)
       AND ($4::TEXT IS NULL OR f.entity_type = $4)
       AND ($5::TEXT IS NULL OR f.entity_id = $5)
       AND ($6::TEXT = 'all' OR f.status = $6)
     ORDER BY
       CASE f.severity WHEN 'high' THEN 0 WHEN 'notable' THEN 1 ELSE 2 END,
       f.created_at DESC
     LIMIT $7`,
    [
      options.fy ?? null,
      options.ruleId ?? null,
      options.severity ?? null,
      options.entityType ?? null,
      options.entityId ?? null,
      status,
      options.limit ?? 100,
    ],
  );

  if (rows.length === 0) return [];

  // Evidence for every flag in one query rather than one per card.
  const evidenceRows = await query<EvidenceRow & { flag_id: number }>(
    `SELECT fe.flag_id, e.evidence_id, e.kind, e.title, e.url, e.published_date,
            e.ministry_id, e.scheme_id, e.summary
     FROM anomaly_flag_evidence fe
     JOIN evidence_item e ON e.evidence_id = fe.evidence_id
     WHERE fe.flag_id = ANY($1::BIGINT[])
     ORDER BY e.published_date DESC NULLS LAST`,
    [rows.map((row) => row.flag_id)],
  );
  const evidenceByFlag = new Map<number, EvidenceItem[]>();
  for (const row of evidenceRows) {
    const list = evidenceByFlag.get(Number(row.flag_id)) ?? [];
    list.push({
      evidenceId: Number(row.evidence_id),
      kind: row.kind as EvidenceKind,
      title: row.title,
      url: row.url,
      publishedDate: row.published_date,
      ministryId: row.ministry_id,
      schemeId: row.scheme_id,
      summary: row.summary,
    });
    evidenceByFlag.set(Number(row.flag_id), list);
  }

  return rows.map((row) => ({
    flagId: Number(row.flag_id),
    ruleId: row.rule_id as AnomalyRuleId,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    entityName: row.entity_name ?? row.entity_id,
    fy: row.fy as FiscalYear,
    severity: row.severity as Severity,
    metric: row.metric,
    explanation: row.explanation,
    status: row.status as FlagStatus,
    createdAt: row.created_at.toISOString(),
    evidence: evidenceByFlag.get(Number(row.flag_id)) ?? [],
  }));
}

/** The most recent verification report for an entity, or null if none is cached. */
export async function getLatestVerificationReport(
  entityType: EntityType,
  entityId: string,
  fy: string,
): Promise<VerificationReport | null> {
  const row = await queryOne<{
    report_id: number;
    entity_type: string;
    entity_id: string;
    entity_name: string | null;
    fy: string;
    narrative_md: string;
    citations: unknown;
    confidence: string;
    generated_at: Date;
    model: string | null;
    prompt_version: string | null;
  }>(
    `SELECT r.*, COALESCE(m.name, s.name, r.entity_id) AS entity_name
     FROM verification_report r
     LEFT JOIN ministry m ON r.entity_type = 'ministry' AND m.ministry_id = r.entity_id
     LEFT JOIN scheme   s ON r.entity_type = 'scheme'   AND s.scheme_id   = r.entity_id
     WHERE r.entity_type = $1 AND r.entity_id = $2 AND r.fy = $3
     ORDER BY r.generated_at DESC
     LIMIT 1`,
    [entityType, entityId, fy],
  );
  if (!row) return null;
  return {
    reportId: Number(row.report_id),
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    entityName: row.entity_name ?? row.entity_id,
    fy: row.fy as FiscalYear,
    narrativeMd: row.narrative_md,
    citations: Array.isArray(row.citations) ? (row.citations as VerificationReport['citations']) : [],
    confidence: row.confidence as Confidence,
    generatedAt: row.generated_at.toISOString(),
    model: row.model ?? undefined,
    promptVersion: row.prompt_version ?? undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export interface SearchHit {
  entityType: 'ministry' | 'scheme';
  entityId: string;
  name: string;
  context: string | null;
  rank: number;
}

/**
 * Search ministries and schemes.
 *
 * Combines full-text rank with trigram similarity, so both "health ministry"
 * and a misspelling like "mgnrega" spelled "manrega" find their target. The
 * alias column is weighted into the tsvector, which is what makes abbreviations
 * such as MoHFW work.
 */
export async function searchEntities(term: string, limit = 20): Promise<SearchHit[]> {
  const trimmed = term.trim();
  if (trimmed.length === 0) return [];
  const rows = await query<{
    entity_type: string;
    entity_id: string;
    name: string;
    context: string | null;
    rank: number;
  }>(
    `SELECT entity_type, entity_id, name, context,
            (ts_rank(document, websearch_to_tsquery('simple', $1)) * 2
             + similarity(name, $1)) AS rank
     FROM mv_search_index
     WHERE document @@ websearch_to_tsquery('simple', $1)
        OR name % $1
     ORDER BY rank DESC
     LIMIT $2`,
    [trimmed, limit],
  );
  return rows.map((row) => ({
    entityType: row.entity_type as 'ministry' | 'scheme',
    entityId: row.entity_id,
    name: row.name,
    context: row.context,
    rank: Number(row.rank),
  }));
}

/* ------------------------------------------------------------------ *
 * Freshness and operations
 * ------------------------------------------------------------------ */

export async function getSourceFreshness(): Promise<SourceFreshness[]> {
  const rows = await query<{
    source_id: string;
    name: string;
    tier: number;
    cadence: string;
    latest_document_date: string | null;
    last_fetched_at: Date | null;
    last_run_status: string | null;
    hours_since_fetch: Numeric;
    is_stale: boolean;
  }>(`SELECT * FROM v_source_freshness ORDER BY tier, name`);
  return rows.map((row) => ({
    sourceId: row.source_id,
    name: row.name,
    tier: row.tier as SourceFreshness['tier'],
    cadence: row.cadence as SourceFreshness['cadence'],
    latestDocumentDate: row.latest_document_date,
    lastFetchedAt: row.last_fetched_at ? row.last_fetched_at.toISOString() : null,
    lastRunStatus: row.last_run_status as SourceFreshness['lastRunStatus'],
    hoursSinceFetch: row.hours_since_fetch === null ? null : Number(row.hours_since_fetch),
    isStale: row.is_stale,
  }));
}

export async function listSourceRegistry(): Promise<SourceRegistryEntry[]> {
  const rows = await query<{
    source_id: string;
    name: string;
    tier: number;
    cadence: string;
    method: string;
    format: string;
    homepage_url: string;
    license_note: string;
    access_note: string | null;
  }>(`SELECT * FROM source_registry WHERE active ORDER BY tier, name`);
  return rows.map((row) => ({
    sourceId: row.source_id,
    name: row.name,
    tier: row.tier as SourceRegistryEntry['tier'],
    cadence: row.cadence as SourceRegistryEntry['cadence'],
    method: row.method,
    format: row.format,
    homepageUrl: row.homepage_url,
    licenseNote: row.license_note,
    accessNote: row.access_note,
  }));
}

export async function listRecentPipelineRuns(limit = 50): Promise<PipelineRun[]> {
  const rows = await query<{
    run_id: number;
    source_id: string;
    started_at: Date;
    finished_at: Date | null;
    status: string;
    metrics: Record<string, unknown>;
  }>(
    `SELECT run_id, source_id, started_at, finished_at, status, metrics
     FROM pipeline_run ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    runId: Number(row.run_id),
    sourceId: row.source_id,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    status: row.status as PipelineRun['status'],
    metrics: row.metrics,
  }));
}

export interface InvariantFinding {
  invariant: string;
  severity: 'error' | 'warn' | 'info';
  fy: string | null;
  entityId: string | null;
  detail: string;
}

export async function runInvariantChecks(fy?: string): Promise<InvariantFinding[]> {
  const rows = await query<{
    invariant: string;
    severity: string;
    fy: string | null;
    entity_id: string | null;
    detail: string;
  }>(`SELECT * FROM check_invariants($1)`, [fy ?? null]);
  return rows.map((row) => ({
    invariant: row.invariant,
    severity: row.severity as InvariantFinding['severity'],
    fy: row.fy,
    entityId: row.entity_id,
    detail: row.detail,
  }));
}

/**
 * True when any figure currently in the database came from the illustrative
 * sample. The layout uses this to decide whether the demo banner is required,
 * so a deployment cannot serve sample figures without saying so.
 */
export async function hasIllustrativeData(): Promise<boolean> {
  const row = await queryOne<{ present: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM fiscal_fact WHERE extraction_method = 'illustrative') AS present`,
  );
  return row?.present ?? false;
}

/** Amount helper re-exported so callers do not need a second import. */
export { NOT_REPORTED, parseAmountCr };
export type { Amount };
