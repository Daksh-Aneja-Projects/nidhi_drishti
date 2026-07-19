/**
 * User-facing string dictionary.
 *
 * Every string the interface shows lives here from day one, so the Hindi
 * interface in docs/07 is a second dictionary rather than a hunt through JSX.
 *
 * House rules, enforced by strings.test.ts:
 *   - No em-dashes or en-dashes. Use commas, full stops, or restructure.
 *   - No emoji.
 *   - No version references. Freshness is communicated by data dates.
 *   - None of the words banned by docs/08 for flag copy.
 *   - Sentence case for labels.
 */

export const strings = {
  site: {
    name: 'Nidhi Drishti',
    tagline: 'Where India’s union budget goes, and how far it has actually moved',
    description:
      'An independent, source linked view of India’s union budget: what was allocated, what has been spent, and what is left, by ministry and scheme.',
  },

  nav: {
    overview: 'Overview',
    ministries: 'Ministries',
    schemes: 'Schemes',
    flags: 'Signals',
    compare: 'Compare',
    methodology: 'Methodology',
    sources: 'Data and sources',
    api: 'API',
    search: 'Search',
    searchPlaceholder: 'Search a ministry or scheme',
  },

  stage: {
    authority: 'Spending authority',
    authorityHelp:
      'The revised estimate where one has been presented, otherwise the budget estimate, plus any supplementary grants voted during the year.',
    spent: 'Spent so far',
    spentHelp:
      'Actual expenditure as accounted by the Controller General of Accounts, cumulative from 1 April.',
    balance: 'Balance remaining',
    balanceHelp: 'Spending authority less expenditure accounted to date.',
  },

  pace: {
    label: 'Spending pace',
    calendarMarker: 'Year elapsed',
    spendMarker: 'Spent',
    lag: 'Behind the calendar',
    lead: 'Ahead of the calendar',
    onPace: 'In step with the calendar',
    help:
      'The pace track compares the share of the allocation spent against the share of the year that had elapsed on the date the expenditure figure covers.',
    unavailable: 'Pace cannot be computed from the reported figures.',
  },

  provenance: {
    trigger: 'Source',
    title: 'Where this figure comes from',
    source: 'Source',
    stage: 'Stage',
    document: 'Document',
    documentDate: 'Document date',
    fetched: 'Fetched',
    method: 'Extraction',
    artifact: 'Stored copy',
    provisional: 'Provisional. The source may revise this figure.',
    openSource: 'Open the source document',
    missing: 'No source record is attached to this figure.',
  },

  freshness: {
    title: 'Data freshness',
    stale: 'Overdue',
    never: 'Not yet fetched',
    updated: 'Updated',
    asOf: 'As of',
    lastFetched: 'Last fetched',
  },

  common: {
    notReported: 'Not reported',
    notReportedHelp:
      'The source does not publish this figure. It is not zero, and we do not estimate it.',
    fiscalYear: 'Financial year',
    ministry: 'Ministry',
    scheme: 'Scheme',
    sector: 'Sector',
    allocation: 'Allocation',
    export: 'Download CSV',
    viewAll: 'View all',
    showTable: 'Show as table',
    hideTable: 'Hide table',
    loading: 'Loading',
    of: 'of',
    notStated: 'Not stated',
    total: 'Total',
    month: 'Month',
    value: 'Value',
    stage: 'Stage',
    provisional: 'Provisional',
    previousYear: 'Previous year',
    thisYear: 'This year',
    sortAscending: 'Sort ascending',
    sortDescending: 'Sort descending',
    unavailable: 'Figures are unavailable right now',
  },

  degraded: {
    title: 'Figures are unavailable right now',
    body:
      'The figures could not be loaded, and nothing is being estimated in their place. Try again shortly.',
  },

  overview: {
    heroEyebrow: 'Union budget',
    treemapTitle: 'Allocation by ministry',
    treemapHelp: 'Area is the spending authority. Colour is the pace against the calendar.',
    attentionTitle: 'Worth a look',
    monthlyTitle: 'Monthly expenditure',
    moversTitle: 'Largest movements',
    residualNote:
      'Ministry allocations do not add up to the national total. The difference is mostly transfers to states and items that sit outside a ministry demand.',
    residualLabel: 'Ministries do not sum to the national total',
    heroTitle: 'The union budget, from allocation to what has moved',
    asOfLabel: 'Expenditure accounted to',
    asOfHelp:
      'The pace comparison is anchored to this date. It is the period end of the most recent monthly account we hold.',
    ministryCount: 'ministries on record',
    treemapEmptyTitle: 'No ministry figures for this year',
    treemapEmptyBody:
      'Ministry level allocations have not been ingested for the selected financial year. Choose another year from the selector.',
    attentionHelp:
      'Signals that have cleared review. Each one states plainly what it does not establish.',
    monthlyHelp:
      'De-cumulated from the cumulative monthly accounts published by the Controller General of Accounts. Hatched months are provisional and may be revised.',
    monthlyEmptyTitle: 'No monthly accounts for this year',
    monthlyEmptyBody:
      'The monthly accounts for the selected financial year have not been ingested yet.',
    moversHelp:
      'The largest revisions to the allocation, and the ministries sitting furthest from the calendar.',
    moversRevision: 'Largest revision to the allocation',
    moversBehind: 'Furthest behind the calendar',
    moversAhead: 'Furthest ahead of the calendar',
    moversEmptyTitle: 'Nothing to rank yet',
    moversEmptyBody:
      'Movements are computed once both a budget estimate and a revised estimate are on record for the year.',
    emptyTitle: 'No figures for this financial year yet',
    emptyBody:
      'Nothing has been ingested for the selected year. Choose a different year from the selector, or read how the figures are compiled.',
  },

  ministries: {
    title: 'Ministries',
    lede:
      'Every ministry demand on record for the selected financial year, with the spending authority, the expenditure accounted to date, and the pace against the calendar.',
    emptyTitle: 'No ministry figures for this year',
    emptyBody:
      'Ministry allocations have not been ingested for the selected financial year. Choose another year from the selector.',
    counted: 'ministries listed',
    colName: 'Ministry',
    colSector: 'Sector',
    colAuthority: 'Spending authority',
    colSpent: 'Spent so far',
    colBalance: 'Balance',
    colPace: 'Pace',
    colSignals: 'Signals',
  },

  ministry: {
    waterfallTitle: 'From allocation to balance',
    monthlyTitle: 'Monthly expenditure',
    schemesTitle: 'Schemes',
    splitTitle: 'Revenue and capital',
    yoyTitle: 'Allocation over five years',
    tendersTitle: 'Procurement activity',
    tabs: {
      overview: 'Overview',
      schemes: 'Schemes',
      verification: 'Verification',
      flags: 'Signals',
      sources: 'Data and sources',
    },
    notFoundTitle: 'That ministry is not in this year’s figures',
    notFoundBody:
      'The ministry may hold no demand in the selected financial year, or the address may be wrong. Start from the ministry list.',
    emptyTitle: 'No figures on record',
    emptyBody:
      'Nothing has been ingested for this ministry in the selected financial year.',
    waterfallHelp:
      'Each step is a different stage of the same rupee. Authority is permission to spend. Expenditure is money accounted as spent.',
    monthlyHelp:
      'De-cumulated from the cumulative monthly accounts. The lighter bars are the same month a year earlier. Hatched months are provisional.',
    monthlyEmpty: 'No monthly accounts have been ingested for this ministry and year.',
    splitHelp:
      'Revenue spending covers running costs. Capital spending creates assets. The split is reported on the expenditure side.',
    splitEmpty: 'The revenue and capital split is not reported for this ministry.',
    yoyHelp:
      'Budget estimate, revised estimate and expenditure for the five most recent financial years on record.',
    yoyEmpty: 'Fewer than two years of allocation are on record for this ministry.',
    schemesEmptyTitle: 'No schemes on record',
    schemesEmptyBody:
      'No scheme level figures have been ingested for this ministry in the selected financial year.',
    schemesCol: {
      name: 'Scheme',
      type: 'Type',
      allocation: 'Allocation',
      released: 'Released',
      utilized: 'Utilised',
      utilizationPct: 'Utilisation',
      tenders: 'Tenders',
    },
    flagsEmptyTitle: 'No signals for this ministry',
    sourcesTitle: 'Records behind the figures on this page',
    sourcesHelp:
      'Each figure on this page traces to one of these records. Open a figure’s source affordance to reach the document directly.',
    sourcesEmpty: 'No source records are attached to the figures on this page.',
    registryTitle: 'Sources used',
    registryHelp:
      'Where the figures come from, with the access route and the licence note recorded for each source.',
    registryCol: {
      source: 'Source',
      tier: 'Tier',
      cadence: 'Cadence',
      method: 'Access method',
      licence: 'Licence note',
    },
    revenueLabel: 'Revenue expenditure',
    capitalLabel: 'Capital expenditure',
    openSignals: 'Open signals',
    backToList: 'All ministries',
  },

  scheme: {
    stagesTitle: 'Allocation, releases and utilisation',
    stagesHelp:
      'These are three different stages of the same rupee. Money can be allocated but not released, and released but not yet reported as utilised.',
    tendersTitle: 'Linked tenders',
    evidenceTitle: 'Recent activity',
    noUtilisation:
      'Utilisation is not reported for this scheme. Utilisation certificates are largely not published per scheme, so coverage is partial.',
    stageAllocation: 'Allocated',
    stageReleased: 'Released',
    stageUtilised: 'Utilised',
    stageChartLabel: 'Allocation, releases and utilisation for this scheme',
    utilisationPct: 'Utilisation of allocation',
    releasedPct: 'Released against allocation',
    tenderValue: 'Value of linked tenders',
    tenderCount: 'Linked tender notices',
    tendersEmpty:
      'No tender notices have been matched to this scheme. Matching is by name against the procurement portal, so an absence here does not mean no procurement took place.',
    evidenceEmpty:
      'No press releases, parliament answers or reports have been matched to this scheme yet.',
    verificationCta: 'Open the verification view',
    tabOverview: 'Overview',
    tabVerification: 'Verification',
    notFoundTitle: 'That scheme is not in our records',
    notFoundBody:
      'The scheme may sit under a different name, or it may not be reported separately in the year you are viewing. Browse the full list of schemes instead.',
    unavailable: 'Scheme figures could not be loaded.',
    unavailableBody:
      'The figures for this scheme are not reachable at the moment. Nothing is estimated in their place. Try again shortly.',
  },

  schemes: {
    title: 'Schemes',
    intro:
      'Every scheme reported separately in the year you are viewing, with what was allocated, what was released, and what has been reported as utilised.',
    filterMinistry: 'Ministry',
    filterType: 'Scheme type',
    allMinistries: 'All ministries',
    allTypes: 'All types',
    typeCss: 'Centrally sponsored',
    typeCs: 'Central sector',
    typeOther: 'Other',
    sort: 'Sort by',
    sortAllocation: 'Largest allocation',
    sortUtilisation: 'Lowest utilisation',
    sortName: 'Name',
    columnScheme: 'Scheme',
    columnMinistry: 'Ministry',
    columnType: 'Type',
    columnAllocation: 'Allocated',
    columnReleased: 'Released',
    columnUtilisation: 'Utilisation',
    columnTenders: 'Tenders',
    empty: 'No schemes are reported for this selection.',
    emptyBody: 'Widen the filters, or choose a different financial year.',
    unavailable: 'Scheme figures could not be loaded.',
    unavailableBody:
      'The scheme list is not reachable at the moment. Nothing is estimated in its place. Try again shortly.',
    resultCount: 'schemes listed',
  },

  filters: {
    legend: 'Filter',
    reset: 'Clear filters',
  },

  tenders: {
    title: 'Linked tenders',
    tier2Title: 'Corroborating signal, not a fiscal figure',
    tier2Note:
      'Tender notices are observable procurement activity published on the procurement portal. They are matched to an entity by name, the match can be wrong or incomplete, and a tender value is not government expenditure.',
    columnDate: 'Published',
    columnTitle: 'Notice',
    columnOrg: 'Buying organisation',
    columnValue: 'Value',
    columnStatus: 'Status',
    match: 'Name match',
    statusPublished: 'Published',
    statusAwarded: 'Awarded',
    statusCancelled: 'Cancelled',
    open: 'Open the notice',
    empty: 'No tender notices matched.',
  },

  evidence: {
    title: 'Recent activity',
    tier2Title: 'Corroborating signal, not a fiscal figure',
    tier2Note:
      'Press releases, parliament answers and reporting are recorded as observable activity around an entity. They are context for the figures, not a source of the figures.',
    empty: 'No items recorded.',
    open: 'Open the item',
    undated: 'No date stated',
  },


  flags: {
    title: 'Signals',
    intro:
      'Patterns worth a second look, produced by published rules over official figures. Each one states plainly what it does not establish.',
    doesNotProve: 'What this does not establish',
    evidence: 'Evidence',
    rule: 'Rule',
    severity: 'Severity',
    empty: 'No signals have been published for this selection.',
    reviewPending: 'Awaiting review',
    emptyBody:
      'Signals are published only once a reviewer has cleared them. Widen the filters, or choose a different financial year.',
    filterRule: 'Rule',
    filterSeverity: 'Severity',
    filterMinistry: 'Ministry',
    allRules: 'All rules',
    allSeverities: 'All severities',
    allMinistries: 'All ministries',
    severityHigh: 'High',
    severityNotable: 'Notable',
    severityInfo: 'Information',
    howMeasured: 'How this was measured',
    showDetail: 'Show how this was measured',
    hideDetail: 'Hide detail',
    measures: 'Measured values',
    noEvidence: 'No documents have been attached to this signal.',
    resultCount: 'signals listed',
    unavailable: 'Signals could not be loaded.',
    unavailableBody:
      'The signal feed is not reachable at the moment. Nothing is estimated in its place. Try again shortly.',
    openEntity: 'Open the entity',
  },

  verification: {
    title: 'Verification',
    aiLabel: 'AI assembled, sources cited',
    generated: 'Generated',
    factsPanel: 'Official figures',
    evidencePanel: 'Observable activity',
    narrative: 'What the sources show',
    regenerate: 'Regenerate',
    empty:
      'No verification narrative has been generated for this entity yet.',
    selfCheckFailed:
      'The generated narrative did not pass the figure check, so the official figures are shown on their own.',
    emptyTitle: 'No narrative has been assembled yet',
    emptyBody:
      'The official figures and the observable activity are shown below and beside, unchanged. A narrative is written only when there is enough cited material to support one.',
    citations: 'Sources cited',
    citationLabel: 'Source',
    confidence: 'Confidence',
    confidenceHigh: 'High',
    confidenceMedium: 'Medium',
    confidenceLow: 'Low',
    entityMissing: 'That entity is not in our records',
    entityMissingBody:
      'Check the address, or start from the list of ministries and schemes.',
    unavailable: 'The verification view could not be loaded.',
    unavailableBody:
      'Neither the figures nor the cited material are reachable at the moment. Nothing is estimated in their place. Try again shortly.',
    openEntity: 'Open the full record',
    fiscalNote:
      'These are the official figures for the entity, taken from the sources cited beside each one. The narrative does not change them.',
  },

  errors: {
    notFound: 'That page does not exist.',
    notFoundBody: 'Check the address, or start from the overview.',
    generic: 'Something went wrong loading this page.',
    genericBody: 'Try again. If it keeps happening, report it and we will look into it.',
    retry: 'Try again',
    reportError: 'Report an error',
  },

  footer: {
    disclaimerTitle: 'About these figures',
    corrections: 'Report an error in a figure',
    builtWith: 'Compiled from public sources listed on the data and sources page.',
  },
} as const;

export type Strings = typeof strings;
