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
  },

  scheme: {
    stagesTitle: 'Allocation, releases and utilisation',
    stagesHelp:
      'These are three different stages of the same rupee. Money can be allocated but not released, and released but not yet reported as utilised.',
    tendersTitle: 'Linked tenders',
    evidenceTitle: 'Recent activity',
    noUtilisation:
      'Utilisation is not reported for this scheme. Utilisation certificates are largely not published per scheme, so coverage is partial.',
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
