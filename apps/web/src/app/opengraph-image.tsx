import { NOT_REPORTED, formatFiscalYearLong } from '@nidhi/core';
import { getNationalSummary } from '@nidhi/db';
import { OG_CONTENT_TYPE, OG_SIZE, formatCardDate, renderShareCard } from '@/lib/og-card';
import { getDataMode, resolveFy } from '@/lib/site';
import { strings } from '@/lib/strings';

/** National share card. */

export const alt = `${strings.site.name}: union budget allocation, expenditure and spending pace`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** Expenditure against the calendar. Shared by the national and ministry cards. */
const FISCAL_LABELS = {
  authority: strings.stage.authority,
  spent: strings.stage.spent,
  balance: strings.stage.balance,
};

const fiscalPaceCaption = ({ spent, reference }: { spent: string; reference: string }) =>
  `${spent} spent, ${reference} of the year elapsed`;

export default async function OpengraphImage() {
  const { fy } = await resolveFy();
  const [national, dataMode] = await Promise.all([getNationalSummary(fy), getDataMode()]);

  // A card is generated even with no figures. A link that unfurls into nothing
  // looks broken, where a card saying the figures are not yet published is
  // simply true.
  if (!national) {
    return renderShareCard({
      eyebrow: strings.site.name,
      title: strings.overview.emptyTitle,
      authority: NOT_REPORTED,
      spent: NOT_REPORTED,
      balance: NOT_REPORTED,
      burn: { pctSpent: NOT_REPORTED, pctFyElapsed: 0, burnRatio: NOT_REPORTED },
      asOf: null,
      dataMode,
      labels: FISCAL_LABELS,
      paceCaption: fiscalPaceCaption,
    });
  }

  return renderShareCard({
    eyebrow: `Union budget · ${formatFiscalYearLong(fy)}`,
    title: 'Government of India',
    authority: national.currentAuthority,
    spent: national.expenditureToDate,
    balance: national.balance,
    burn: national.burn,
    asOf: formatCardDate(national.expenditureAsOf),
    dataMode,
    labels: FISCAL_LABELS,
    paceCaption: fiscalPaceCaption,
  });
}
