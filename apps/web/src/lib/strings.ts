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

  apiDocs: {
    title: 'API',
    eyebrow: 'For journalists, researchers and developers',
    lede:
      'A read only interface to the same figures the pages show. Every response carries the freshness of its sources and the site disclaimer, so a machine consumer gets the context a reader gets.',
    baseTitle: 'Base address',
    baseBody: 'All endpoints answer to GET only, return JSON, and need no key.',
    endpointsTitle: 'Endpoints',
    endpointsPath: 'Path',
    endpointsPurpose: 'Returns',
    endpointsParams: 'Parameters',
    envelopeTitle: 'Response shape',
    envelopeBody:
      'Every successful response is an object with a data field and a meta field. The meta field carries the financial year, the moment the response was assembled, whether the deployment is serving illustrative figures, the freshness of each source, and the disclaimer.',
    absenceTitle: 'Absent figures',
    absenceBody:
      'A figure the source does not publish is returned as null. Null means not reported. It does not mean zero, and it must not be added up as zero.',
    stagesTitle: 'Stages are separate fields',
    stagesBody:
      'Budget estimate, revised estimate, sanction, release and utilisation are five different things and are never merged into one number. Read the methodology page before combining them.',
    rateTitle: 'Rate limit',
    rateBody:
      'Requests are counted per address per minute. Over the allowance the interface answers with status 429 and a Retry-After header saying how long to wait. The remaining allowance is on every response.',
    errorsTitle: 'Errors',
    errorsBody:
      'A failed request returns an object with an error field carrying a code and a message. A malformed financial year gives status 400. An unknown ministry or scheme gives status 404. A store that cannot be read gives status 503.',
    exportsTitle: 'Spreadsheet exports',
    exportsBody:
      'Export routes return comma separated values with a commented preamble naming every underlying source. Keep the preamble attached when you republish the file.',
    termsTitle: 'Use and attribution',
    termsBody:
      'Attribute the publishing institutions listed on the data and sources page, and cite the document dates carried in the response. This project is not affiliated with the Government of India and is not a substitute for the official record.',
    healthTitle: 'Availability',
    healthBody:
      'A health endpoint reports the database, the cache and the age of the freshest source, for anyone running a monitor against this deployment.',
  },

  methodology: {
    title: 'Methodology',
    eyebrow: 'How these figures are made',
    lede:
      'What we fetch, how it becomes a number on a page, what the rules test for, and the things this data cannot tell you.',
    pipelineTitle: 'How a figure reaches this site',
    pipelineSteps: [
      'A fetcher downloads the published document from the institution that issued it, at the pace that institution publishes.',
      'The document is stored exactly as fetched, hashed and never edited, so any figure can be traced back to the page it came from.',
      'A parser reads the tables and writes rows into a staging area with no interpretation applied.',
      'Every row is checked against a schema. A source that changes shape raises an alert and writes nothing, rather than writing something plausible and wrong.',
      'Entity resolution maps the names the document uses to stable ministry and scheme identifiers.',
      'The canonical tables record each figure with its stage, its period, and the source record it came from. Aggregates are computed from those tables and never stored by hand.',
    ],
    stagesTitle: 'Five stages, not one number',
    stagesBody:
      'Allocation is not spending. A rupee can be budgeted, revised, sanctioned, released, and only then reported as utilised, and it can stop at any of those points. Combining them produces a figure that looks authoritative and means nothing, so they are kept apart everywhere: in the database, in the interface, and in the API.',
    rulesTitle: 'The rules behind the signals',
    rulesBody:
      'Signals are produced by published rules over official figures, not by a model forming an opinion. Each rule states what it tests for and what it does not establish. Every signal above the lowest severity is reviewed by a person before it appears in public.',
    rulesLimitTitle: 'What the rules cannot do',
    rulesLimitBody:
      'The rules work on what is published. They cannot see money that moves outside the accounts they read, they cannot tell a delayed payment from a delayed accounting entry, and they compare entities whose spending patterns are legitimately different. A signal is an invitation to look, never a finding.',
    limitsTitle: 'What this data cannot tell you',
    limits: [
      'Government treasury movements are not published as they happen. The most current official actuals are the monthly accounts of the Controller General of Accounts, which appear about a month after the month they cover, and provisional figures are revised later.',
      'Utilisation certificates are largely not published per scheme, so utilisation coverage is partial and comes from a mix of accounts, parliament answers and scheme portals.',
      'Spending by states on centrally sponsored schemes is visible only as far as single nodal agency reporting makes it visible, and confidence is labelled accordingly.',
      'Ministry allocations do not add up to the national total. The difference is mostly transfers to states and items that sit outside a ministry demand, and it is shown rather than hidden.',
      'Procurement matching relies on organisation names in tender records, which are inconsistent. A missing match does not mean a missing tender.',
    ],
    correctionsTitle: 'Corrections',
    correctionsBody:
      'If a figure here disagrees with the source document, the source document is right and we want to know. Reports are logged, and a correction that changes a published figure is recorded with what changed and when.',
    analyticsTitle: 'What is measured about usage',
    analyticsBody:
      'Usage measurement is anonymous. There are no accounts, no identifiers, no advertising trackers, and search text is never sent, only its length. Sessions that signal Do Not Track or Global Privacy Control are not measured at all. The complete list of what is collected is below.',
    analyticsEventsTitle: 'Events collected',
    stageColumn: 'Stage',
    meaningColumn: 'What it means',
  },

  sourcesPage: {
    title: 'Data and sources',
    eyebrow: 'Attribution',
    lede:
      'Every source this site reads, how it is accessed, how often it is checked, and the terms it is published under.',
    tier: 'Tier',
    cadence: 'Checked',
    method: 'Access',
    format: 'Format',
    licence: 'Licence',
    accessNote: 'Access note',
    homepage: 'Publisher',
    freshness: 'Last fetched',
    empty: 'No sources are registered in this deployment yet.',
    tierHelp:
      'Tier one sources carry the fiscal figures. Tier two sources are the activity signals used for verification. Tier three is reference data.',
    licenceNote:
      'Government data is reused under the terms each publisher states, with attribution. Where a publisher asked for a different access route, the note says so.',
  },

  corrections: {
    title: 'Report an error in a figure',
    eyebrow: 'Corrections',
    lede:
      'If something here disagrees with the source document, tell us. Corrections are logged and the source document wins.',
    entityTypeLabel: 'What is it about',
    entityTypeAny: 'Not sure',
    entityIdLabel: 'Ministry or scheme identifier, if you know it',
    fyLabel: 'Financial year, if it applies',
    noteLabel: 'What is wrong',
    noteHelp:
      'Say which figure, what it shows, and what the source document says instead. A link to the document helps most of all.',
    contactLabel: 'Contact, if you would like a reply',
    contactHelp:
      'Optional. Used only to reply about this report, and nothing else is collected.',
    submit: 'Send report',
    successTitle: 'Report received',
    successBody:
      'Thank you. Reports are reviewed against the source document, and a figure that turns out to be wrong is corrected and logged.',
    errorEmptyTitle: 'Nothing was sent',
    errorEmptyBody: 'Describe what is wrong with the figure and send the report again.',
    errorFailedTitle: 'The report could not be saved',
    errorFailedBody: 'Try again shortly. Nothing you typed was stored.',
    policyTitle: 'What happens next',
    policyBody:
      'Reports are checked against the document the figure came from. Corrections that change a published figure are recorded with what changed and when.',
  },

  compare: {
    title: 'Compare',
    eyebrow: 'Side by side',
    lede:
      'Put up to four ministries or schemes beside each other on the same measures. The selection is in the address, so a comparison can be shared as a link.',
    addMinistry: 'Add a ministry',
    addScheme: 'Add a scheme',
    remove: 'Remove',
    clear: 'Clear the selection',
    full: 'Four entities is the limit. Remove one to add another.',
    empty: 'Nothing is selected yet.',
    emptyBody: 'Choose a ministry or a scheme from the lists to start a comparison.',
    metric: 'Measure',
    mixedNote:
      'Ministries and schemes report different stages, so a measure that one side does not publish shows as not reported.',
  },

  ops: {
    title: 'Operations',
    eyebrow: 'Internal',
    lede: 'Pipeline runs, source staleness, parse errors and the invariant checks.',
    runsTitle: 'Recent pipeline runs',
    runsEmpty: 'No pipeline run has been recorded yet.',
    runStatus: 'Status',
    runSource: 'Source',
    runStarted: 'Started',
    runDuration: 'Duration',
    runRows: 'Rows',
    runErrors: 'Parse errors',
    statusTitle: 'Runs by status',
    stalenessTitle: 'Source staleness',
    stalenessEmpty: 'No source has been fetched yet.',
    parseErrorsTitle: 'Parse errors by source',
    parseErrorsEmpty: 'No parse errors have been recorded in the runs shown.',
    invariantsTitle: 'Invariant checks',
    invariantsEmpty: 'Every invariant check passed.',
    invariant: 'Check',
    detail: 'Detail',
    entity: 'Entity',
    severity: 'Severity',
    unavailable: 'The operations view could not read the database.',
  },

  digest: {
    title: 'Daily digest',
    eyebrow: 'What was published today',
    lede:
      'Signals that cleared review, and the activity summarised alongside them, gathered by the day they were published. Nothing here is new: every line was already published on this site, and the digest only arranges it.',
    todayTitle: 'Today',
    signalsTitle: 'Signals published',
    signalsHelp:
      'Each signal cleared human review before it appeared. Each one states plainly what it does not establish.',
    evidenceTitle: 'Activity summarised',
    evidenceHelp:
      'Press releases, parliament answers and reporting matched to an entity. Context around the figures, never a source of the figures.',
    quietTitle: 'A quiet day',
    quietBody:
      'No signal cleared review and no activity was summarised on this date. That is an ordinary outcome, not a gap in the record.',
    recentTitle: 'Earlier editions',
    recentHelp: 'Days on which something was published. Each one keeps its own address.',
    recentEmpty: 'No edition has anything in it yet.',
    signalsCounted: 'signals',
    evidenceCounted: 'summarised items',
    unavailable: 'The digest could not be assembled.',
    unavailableBody:
      'The published record is not reachable at the moment. Nothing is estimated in its place. Try again shortly.',
    notFoundTitle: 'That is not a date we can show',
    notFoundBody:
      'A digest address is a calendar day written as four digits, two digits, two digits. Start from the latest edition.',
    latest: 'Latest edition',
    subscribeTitle: 'Follow this without an account',
    subscribeBody:
      'The digest is published as a feed you can read in any feed reader. There is no sign up, no email list and no account, because collecting an address would mean collecting personal data this project has no need for.',
    subscribeLink: 'Open the feed',
    subscribeFlagsLink: 'Open the signals feed',
    dateLabel: 'Edition',
  },

  feed: {
    siteTitle: 'Nidhi Drishti, signals and activity',
    siteSubtitle:
      'Signals that cleared review, and the activity summarised alongside them, as they are published.',
    flagsTitle: 'Nidhi Drishti, signals',
    flagsSubtitle:
      'Patterns worth a second look, produced by published rules over official figures and cleared by a reviewer before publication. Each entry states plainly what it does not establish.',
    ministrySuffix: 'signals and activity',
    ministrySubtitle:
      'Signals and summarised activity for one ministry and the schemes under it, published only after review.',
    doesNotEstablish: 'What this does not establish',
    evidenceCaveat:
      'This is observable activity around an entity, matched by name. It is context for the figures and never a source of the figures.',
    authorName: 'Nidhi Drishti',
    nationalEntity: 'Union budget',
    ministryUnknownTitle: 'Nidhi Drishti, signals and activity',
  },

  admin: {
    reviewTitle: 'Signal review',
    reviewEyebrow: 'Internal',
    reviewLede:
      'Signals awaiting review. Nothing here is public until it is approved, and the reviewer is recorded against the decision.',
    queueEmpty: 'The review queue is empty.',
    queueEmptyBody: 'Every signal raised so far has been reviewed.',
    approve: 'Approve',
    reject: 'Reject',
    noteLabel: 'Review note',
    notePlaceholder: 'Why this decision, for the record',
    raised: 'Raised',
    metric: 'Rule figures',
    evidence: 'Evidence',
    unavailableTitle: 'Not available',
    unavailableBody: 'This address is not available.',
  },
} as const;

export type Strings = typeof strings;
