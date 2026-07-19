import {
  fiscalYearOf,
  isFiscalYear,
  type DataMode,
  type FiscalYear,
  type SourceFreshness,
} from '@nidhi/core';
import {
  getDefaultFiscalYear,
  getSourceFreshness,
  hasIllustrativeData,
  listFiscalYearsWithData,
} from '@nidhi/db';

/**
 * Site-level context every page needs: which financial year is being viewed,
 * and whether this deployment is serving illustrative figures.
 */

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

/**
 * The data mode of this deployment.
 *
 * `demo` is not a styling flag. It means illustrative sample figures are being
 * served, and it forces a persistent banner so a sample number can never be
 * screenshotted and mistaken for a reported one. It is derived from the data
 * actually present as well as from the environment, so a deployment that loaded
 * the sample dataset and forgot to set the variable still declares itself.
 */
export async function getDataMode(): Promise<DataMode> {
  if (process.env.DATA_MODE === 'demo') return 'demo';
  return (await hasIllustrativeData()) ? 'demo' : 'live';
}

export interface FyContext {
  fy: FiscalYear;
  available: FiscalYear[];
}

export interface ChromeContext extends FyContext {
  dataMode: DataMode;
  freshness: SourceFreshness[];
  /** True when the database could not be reached at all. */
  degraded: boolean;
}

/**
 * Everything the header, freshness bar and footer need, in one call.
 *
 * Tolerates the database being unreachable and returns a degraded context
 * instead of throwing. Two reasons: a build running in CI has no database, and
 * in production a database blip should leave a reader with a page that says the
 * figures are unavailable rather than an error screen that says nothing at all.
 * Pages check `degraded` and say so plainly; nothing renders a zero.
 */
export async function loadChrome(requestedFy?: string | string[]): Promise<ChromeContext> {
  try {
    const [fyContext, dataMode, freshness] = await Promise.all([
      resolveFy(requestedFy),
      getDataMode(),
      getSourceFreshness(),
    ]);
    return { ...fyContext, dataMode, freshness, degraded: false };
  } catch (error) {
    console.error('[site] could not load chrome context', error);
    return {
      fy: fiscalYearOf(new Date()),
      available: [],
      dataMode: 'live',
      freshness: [],
      degraded: true,
    };
  }
}

/**
 * Resolve the financial year for a request.
 *
 * Falls back through: a valid `fy` query parameter, the newest year with any
 * expenditure reported, then the current year by the calendar. The middle step
 * matters because the current calendar year has no data until the first CGA
 * accounts of it are published, and landing on an empty page is worse than
 * landing on the most recent complete one.
 */
export async function resolveFy(requested?: string | string[]): Promise<FyContext> {
  const available = await listFiscalYearsWithData();
  const candidate = Array.isArray(requested) ? requested[0] : requested;

  if (candidate && isFiscalYear(candidate) && available.includes(candidate)) {
    return { fy: candidate, available };
  }

  const preferred = await getDefaultFiscalYear();
  return { fy: preferred ?? fiscalYearOf(new Date()), available };
}
