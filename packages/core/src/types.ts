/**
 * Shared domain contract.
 *
 * These types mirror the canonical schema in docs/04 and are the single source
 * of truth shared by the API, the web app, and the JSON contracts the Python
 * pipelines and agents write against. Change them here first.
 */

import type { Amount } from './money';
import type { FiscalYear } from './fy';

/* ------------------------------------------------------------------ *
 * Fiscal stages
 * ------------------------------------------------------------------ */

/**
 * The five fiscal stages, never to be conflated (CLAUDE.md principle 2).
 *
 * BE and RE are *authority* (permission to spend). SANCTION, RELEASE and
 * UTILIZATION track money actually moving. EXPENDITURE is the CGA's accounted
 * actual, which is the citable "spent so far" figure.
 */
export const FISCAL_STAGES = [
  'BE',
  'RE',
  'SUPPLEMENTARY',
  'SANCTION',
  'RELEASE',
  'EXPENDITURE',
  'UTILIZATION',
] as const;

export type FiscalStage = (typeof FISCAL_STAGES)[number];

/** Stages that confer spending authority, and so belong on the allocation side. */
export const AUTHORITY_STAGES = ['BE', 'RE', 'SUPPLEMENTARY'] as const satisfies readonly FiscalStage[];

/** Stages that represent money in motion or already spent. */
export const OUTFLOW_STAGES = [
  'SANCTION',
  'RELEASE',
  'EXPENDITURE',
  'UTILIZATION',
] as const satisfies readonly FiscalStage[];

export function isAuthorityStage(stage: FiscalStage): boolean {
  return (AUTHORITY_STAGES as readonly FiscalStage[]).includes(stage);
}

/** Human labels. Kept here so the UI never invents its own stage wording. */
export const FISCAL_STAGE_LABELS: Record<FiscalStage, string> = {
  BE: 'Budget estimate',
  RE: 'Revised estimate',
  SUPPLEMENTARY: 'Supplementary grant',
  SANCTION: 'Sanctioned',
  RELEASE: 'Released',
  EXPENDITURE: 'Expenditure',
  UTILIZATION: 'Utilised',
};

/** One-line explanation surfaced in stage tooltips. No em-dashes (docs/06). */
export const FISCAL_STAGE_DESCRIPTIONS: Record<FiscalStage, string> = {
  BE: 'The amount proposed in the Union Budget presented on 1 February.',
  RE: 'The allocation as revised part way through the year, presented with the next budget.',
  SUPPLEMENTARY: 'Additional spending authority granted by Parliament during the year.',
  SANCTION: 'The ministry has formally approved the spending, but the money has not necessarily moved.',
  RELEASE: 'Funds have left the government account towards an implementing agency.',
  EXPENDITURE: 'Actual expenditure as accounted by the Controller General of Accounts.',
  UTILIZATION: 'Amount the implementing agency reports as actually spent on the ground.',
};

/** `head` on a fiscal fact: the revenue/capital split. */
export type ExpenditureHead = 'revenue' | 'capital' | 'total';

/* ------------------------------------------------------------------ *
 * Entities
 * ------------------------------------------------------------------ */

/**
 * Fiscal entity kinds. `state` and `state_department` were added for the v2
 * state-budgets line (docs/12). They share the fiscal_fact table and every
 * reconciliation rule with the Union entities; the summaries stay separate
 * because each materialised view filters by entity_type.
 */
export type EntityType = 'ministry' | 'scheme' | 'national' | 'state' | 'state_department';

/**
 * The single entity id used for national aggregates.
 *
 * Exported rather than written as a literal at each call site: the national
 * rollup is joined by string in several views and queries, and a typo would
 * silently produce an empty national page rather than an error.
 */
export const NATIONAL_ENTITY_ID = 'india';

export interface Ministry {
  ministryId: string;
  name: string;
  sector: string | null;
  active: boolean;
}

export type SchemeType = 'CSS' | 'CS' | 'other';

export interface Scheme {
  schemeId: string;
  ministryId: string | null;
  ministryName?: string | null;
  name: string;
  schemeType: SchemeType | null;
  active: boolean;
}

export interface EntityRef {
  entityType: EntityType;
  entityId: string;
  name: string;
}

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

/** Confidence in a derived or matched value. Displayed, never hidden. */
export type Confidence = 'high' | 'medium' | 'low';

/**
 * The provenance record attached to every displayed figure.
 *
 * CLAUDE.md principle 3: if a number is on screen, the user can open this.
 * A metric with no provenance is a bug, not a styling choice.
 */
export interface Provenance {
  sourceRecordId: number;
  /** Registry id, e.g. `cga_monthly`. */
  sourceId: string;
  /** Human name of the publishing institution. */
  sourceName: string;
  /** Direct link to the source document, where one exists. */
  url: string | null;
  /** Object-store key of the immutable raw artifact we parsed. */
  artifactKey: string | null;
  /** Date the document itself claims. */
  documentDate: string | null;
  /** When we fetched it (UTC ISO-8601). */
  fetchedAt: string;
  /** How the figure was extracted from the artifact. */
  extractionMethod: ExtractionMethod;
  /** True when the source labels the figure provisional and may revise it. */
  isProvisional: boolean;
  /** How the document itself was obtained. */
  retrievalMethod: RetrievalMethod;
  /**
   * Who downloaded it, for a manual retrieval. Null for an automated fetch,
   * which was performed by nobody in particular.
   */
  retrievedBy: string | null;
}

/**
 * How a document came into our hands.
 *
 * Some official portals refuse automated clients outright, and the answer is a
 * person downloading the file in a browser rather than a cleverer scraper
 * (docs/08 section 1). Both routes produce real evidence, but they do not carry
 * the same guarantees: an automated source re-runs on a schedule, a manual one
 * is only as current as the last time somebody did it. The reader is told
 * which, rather than left to assume.
 */
export type RetrievalMethod = 'automated' | 'operator_download';

export const RETRIEVAL_METHOD_LABELS: Record<RetrievalMethod, string> = {
  automated: 'Fetched automatically from the source',
  operator_download: 'Downloaded by hand from the source portal',
};

export type ExtractionMethod =
  | 'structured_api'
  | 'csv_parse'
  | 'html_table'
  | 'pdf_table'
  | 'pdf_text'
  | 'agent_assisted'
  | 'manual_entry'
  | 'illustrative';

export const EXTRACTION_METHOD_LABELS: Record<ExtractionMethod, string> = {
  structured_api: 'Structured API',
  csv_parse: 'CSV parse',
  html_table: 'HTML table parse',
  pdf_table: 'PDF table extraction',
  pdf_text: 'PDF text extraction',
  agent_assisted: 'AI assisted extraction, human reviewed',
  manual_entry: 'Manual entry from source document',
  illustrative: 'Illustrative sample, not a real figure',
};

/** A single displayable figure bundled with the evidence for it. */
export interface SourcedAmount {
  value: Amount;
  stage: FiscalStage;
  provenance: Provenance | null;
}

/* ------------------------------------------------------------------ *
 * Aggregates served to the dashboard
 * ------------------------------------------------------------------ */

/**
 * Burn ratio = share of authority spent divided by share of the year elapsed.
 *
 * 1.0 means spending is exactly on pace. Below 1 is underspending, above 1 is
 * running ahead of the calendar. It is the product's central metric and is
 * always computed in views, never stored (docs/04 invariant 4).
 */
export interface BurnMetrics {
  pctSpent: Amount;
  pctFyElapsed: number;
  burnRatio: Amount;
}

export interface MinistrySummary {
  fy: FiscalYear;
  ministryId: string;
  name: string;
  sector: string | null;
  be: Amount;
  re: Amount;
  supplementary: Amount;
  /** RE where one exists, else BE, plus supplementary grants. The live authority. */
  currentAuthority: Amount;
  expenditureToDate: Amount;
  /** Period end of the latest cumulative expenditure fact used above. */
  expenditureAsOf: string | null;
  balance: Amount;
  revenueExpenditure: Amount;
  capitalExpenditure: Amount;
  burn: BurnMetrics;
  openFlagCount: number;
  provenance: {
    authority: Provenance | null;
    expenditure: Provenance | null;
  };
}

export interface NationalSummary {
  fy: FiscalYear;
  be: Amount;
  re: Amount;
  supplementary: Amount;
  currentAuthority: Amount;
  expenditureToDate: Amount;
  expenditureAsOf: string | null;
  balance: Amount;
  burn: BurnMetrics;
  ministryCount: number;
  /**
   * Sum of ministry BE minus national BE. Non-zero is expected (transfers to
   * states, "Others"), so we surface it rather than hiding the discrepancy.
   * docs/04 invariant 1.
   */
  ministrySumResidual: Amount;
  provenance: {
    authority: Provenance | null;
    expenditure: Provenance | null;
  };
}

export interface SchemeSummary {
  fy: FiscalYear;
  schemeId: string;
  name: string;
  ministryId: string | null;
  ministryName: string | null;
  schemeType: SchemeType | null;
  allocation: Amount;
  released: Amount;
  utilized: Amount;
  utilizationPct: Amount;
  tenderCount: number;
  tenderValue: Amount;
  provenance: {
    allocation: Provenance | null;
    released: Provenance | null;
    utilized: Provenance | null;
  };
}

/** One de-cumulated month of spend. */
export interface MonthlySpendPoint {
  /** First day of the month, ISO date. */
  periodStart: string;
  periodEnd: string;
  fiscalMonthIndex: number;
  label: string;
  /** Cumulative figure exactly as the source published it. */
  cumulative: Amount;
  /**
   * De-cumulated month figure: cumulative(m) minus cumulative(m-1).
   * Can be negative when a source revises downward. We keep the negative and
   * flag it rather than clamping, per docs/04.
   */
  monthly: Amount;
  isProvisional: boolean;
  /** True when de-cumulation produced a negative month, indicating a revision. */
  isRevisionArtifact: boolean;
  provenance: Provenance | null;
}

/* ------------------------------------------------------------------ *
 * Verification layer
 * ------------------------------------------------------------------ */

export type TenderStatus = 'published' | 'awarded' | 'cancelled';

export interface Tender {
  tenderId: string;
  title: string;
  orgRaw: string;
  ministryId: string | null;
  schemeId: string | null;
  valueInrCr: Amount;
  status: TenderStatus;
  publishedDate: string | null;
  awardDate: string | null;
  url: string | null;
  /** Confidence of the entity match, from the resolution agent. */
  matchConfidence: Confidence | null;
}

export type EvidenceKind = 'pib' | 'news' | 'parliament_qa';

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  pib: 'Press Information Bureau',
  news: 'Media reporting',
  parliament_qa: 'Parliament question',
};

export interface EvidenceItem {
  evidenceId: number;
  kind: EvidenceKind;
  title: string;
  url: string | null;
  publishedDate: string | null;
  ministryId: string | null;
  schemeId: string | null;
  summary: string | null;
}

export type AnomalyRuleId =
  | 'march_rush'
  | 'under_utilization'
  | 'over_burn'
  | 'spend_no_tender'
  | 'revision_swing'
  | 'stat_outlier';

export type Severity = 'info' | 'notable' | 'high';

export type FlagStatus = 'pending' | 'approved' | 'rejected';

export interface AnomalyRuleMeta {
  ruleId: AnomalyRuleId;
  label: string;
  /** What the rule tests for, in plain language. */
  description: string;
  /**
   * The credibility armour required on every flag card (docs/06 P4, docs/08).
   * States plainly what the flag does NOT establish.
   */
  doesNotProve: string;
}

/**
 * Rule catalogue. The UI reads labels and caveats from here so that the
 * "what this does not prove" line can never be omitted by accident.
 */
export const ANOMALY_RULES: Record<AnomalyRuleId, AnomalyRuleMeta> = {
  march_rush: {
    ruleId: 'march_rush',
    label: 'Year end spending concentration',
    description:
      'More than 30% of the year’s expenditure falls in the January to March quarter, or more than 15% in March alone.',
    doesNotProve:
      'This does not prove waste or irregularity. Many payment cycles, contract milestones and settlement processes legitimately land at the close of the financial year.',
  },
  under_utilization: {
    ruleId: 'under_utilization',
    label: 'Spending behind schedule',
    description:
      'Less than half the expected share of the allocation has been spent once more than half the financial year has elapsed.',
    doesNotProve:
      'This does not prove that funds were withheld or diverted. Procurement lead times, seasonal programmes and delayed accounting all produce the same pattern.',
  },
  over_burn: {
    ruleId: 'over_burn',
    label: 'Spending ahead of allocation',
    description:
      'Expenditure is running more than 30% ahead of the pace implied by the current spending authority.',
    doesNotProve:
      'This does not prove an overrun. Front loaded programmes and pending supplementary grants both produce this pattern legitimately.',
  },
  spend_no_tender: {
    ruleId: 'spend_no_tender',
    label: 'Releases without matching procurement activity',
    description:
      'Funds were released for a capital heavy entity, but no matching tender activity appears on the Central Public Procurement Portal in the trailing 90 days.',
    doesNotProve:
      'This does not prove that no procurement occurred. A great deal of government procurement runs through GeM, state portals or the entity’s own systems rather than CPPP, and our name matching is imperfect.',
  },
  revision_swing: {
    ruleId: 'revision_swing',
    label: 'Large revision to the allocation',
    description:
      'The revised estimate differs from the budget estimate by more than 25%.',
    doesNotProve:
      'This does not prove a planning failure. Revised estimates exist precisely so that allocations can respond to changed circumstances during the year.',
  },
  stat_outlier: {
    ruleId: 'stat_outlier',
    label: 'Unusual monthly spend',
    description:
      'Monthly expenditure sits far outside the range this entity recorded in the same month of previous years.',
    doesNotProve:
      'This does not prove an error. One large legitimate payment, or a change in how a programme is accounted for, moves this measure sharply.',
  },
};

export interface AnomalyFlag {
  flagId: number;
  ruleId: AnomalyRuleId;
  entityType: EntityType;
  entityId: string;
  entityName: string;
  fy: FiscalYear;
  severity: Severity;
  /** Rule-specific numbers backing the flag. */
  metric: Record<string, unknown>;
  explanation: string;
  status: FlagStatus;
  createdAt: string;
  evidence: EvidenceItem[];
}

export interface Citation {
  n: number;
  url: string;
  title: string;
  date: string | null;
  kind: EvidenceKind | 'tender' | 'fiscal';
}

export interface VerificationReport {
  reportId: number;
  entityType: EntityType;
  entityId: string;
  entityName: string;
  fy: FiscalYear;
  narrativeMd: string;
  citations: Citation[];
  confidence: Confidence;
  generatedAt: string;
  /** Present in admin surfaces only; never rendered publicly (docs/06 rule 4). */
  model?: string;
  promptVersion?: string;
}

/* ------------------------------------------------------------------ *
 * Freshness and operations
 * ------------------------------------------------------------------ */

export type SourceTier = 1 | 2 | 3;

export type SourceCadence = 'daily' | 'weekly' | 'monthly' | 'annual' | 'per_session' | 'ad_hoc';

export interface SourceRegistryEntry {
  sourceId: string;
  name: string;
  tier: SourceTier;
  cadence: SourceCadence;
  method: string;
  format: string;
  homepageUrl: string;
  licenseNote: string;
  /** Set when robots.txt or terms led us to a different access route (docs/08). */
  accessNote: string | null;
}

/** Per-source freshness, rendered in the freshness bar on every page. */
export interface SourceFreshness {
  sourceId: string;
  name: string;
  tier: SourceTier;
  cadence: SourceCadence;
  /** Date the newest document from this source claims. */
  latestDocumentDate: string | null;
  /** When we last successfully fetched from this source. */
  lastFetchedAt: string | null;
  lastRunStatus: PipelineRunStatus | null;
  hoursSinceFetch: number | null;
  /** True once the gap exceeds twice the expected cadence (docs/09 alerting). */
  isStale: boolean;
}

export type PipelineRunStatus = 'ok' | 'drift_alert' | 'failed' | 'running';

export interface PipelineRun {
  runId: number;
  sourceId: string;
  startedAt: string;
  finishedAt: string | null;
  status: PipelineRunStatus;
  metrics: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * API envelope
 * ------------------------------------------------------------------ */

/**
 * Every public API response carries the data mode and freshness, so that a
 * consumer of the JSON has the same honesty guarantees as a viewer of the page.
 */
export interface ApiEnvelope<T> {
  data: T;
  meta: {
    fy: FiscalYear;
    generatedAt: string;
    dataMode: DataMode;
    freshness: SourceFreshness[];
    disclaimer: string;
  };
}

/**
 * `live` serves only pipeline-ingested figures. `demo` additionally serves the
 * clearly labelled illustrative dataset and forces a banner on every page, so
 * that a sample figure can never be mistaken for a reported one.
 */
export type DataMode = 'live' | 'demo';

export const SITE_DISCLAIMER =
  'Nidhi Drishti is an independent transparency project. It is not affiliated with the Government of India. All figures are compiled from cited public sources and may be provisional or revised. AI assembled analyses are labelled and cite their sources. For official figures, refer to indiabudget.gov.in, cga.nic.in, and pfms.nic.in.';

export const DEMO_DATA_NOTICE =
  'This deployment is serving an illustrative sample dataset so that the interface can be reviewed before live ingestion. The figures shown are not reported government figures and must not be cited.';

export const AI_NARRATIVE_NOTICE =
  'AI assembled from cited public sources. This is not an official reconciliation.';

/* ------------------------------------------------------------------ *
 * State budgets (v2, docs/12)
 * ------------------------------------------------------------------ */

/** A state has its own budget by right; a union territory may or may not. */
export type StateKind = 'state' | 'ut';

export const STATE_KIND_LABELS: Record<StateKind, string> = {
  state: 'State',
  ut: 'Union territory',
};

export interface StateEntity {
  stateId: string;
  name: string;
  kind: StateKind;
  /** Editorial grouping for the dashboard, no official status. */
  region: string | null;
  /**
   * False for the union territories with no legislative assembly, whose
   * expenditure runs through the Union budget rather than a state budget of
   * their own. The UI uses this to avoid implying a treasury portal that does
   * not exist.
   */
  hasLegislature: boolean;
  active: boolean;
}

export interface StateDepartment {
  stateDepartmentId: string;
  stateId: string;
  name: string;
  sector: string | null;
  active: boolean;
}

/**
 * A state budget summary, the state analogue of {@link MinistrySummary}.
 *
 * The figures are the state's own totals as it publishes them, which blend the
 * state's own revenue with central transfers it receives. That is correct as a
 * state figure and is why it is never added to the Union total: the central
 * transfers are already counted on the Union side (docs/12, the CSS rule).
 */
export interface StateSummary {
  fy: FiscalYear;
  stateId: string;
  name: string;
  kind: StateKind;
  region: string | null;
  be: Amount;
  re: Amount;
  supplementary: Amount;
  /** RE where one exists, else BE, plus supplementary. The live authority. */
  currentAuthority: Amount;
  expenditureToDate: Amount;
  /** Period end of the latest expenditure fact used above. */
  expenditureAsOf: string | null;
  balance: Amount;
  revenueExpenditure: Amount;
  capitalExpenditure: Amount;
  burn: BurnMetrics;
  provenance: {
    authority: Provenance | null;
    expenditure: Provenance | null;
  };
}

/**
 * The funding side a fact belongs to (docs/12). A Union source writes the
 * central ledger; a state treasury portal writes the state ledger. The two are
 * presented separately and never summed into one figure without netting out the
 * central transfers that appear in both, which is how the same rupee would
 * otherwise be counted twice.
 */
export type Jurisdiction = 'union' | 'state';

export const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  union: 'Union',
  state: 'State',
};

/**
 * Why a Union total and a state total are not added together.
 *
 * Surfaced wherever the two ledgers sit near each other, so a reader who is
 * tempted to sum them sees why the product does not.
 */
export const LEDGER_SEPARATION_NOTICE =
  'Union and state budgets are shown as separate ledgers. They are not added together, because central transfers to a state are already counted in the Union budget and would otherwise be counted twice.';
