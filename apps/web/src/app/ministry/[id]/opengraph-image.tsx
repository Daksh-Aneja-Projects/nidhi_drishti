import { NOT_REPORTED, formatFiscalYearLong } from '@nidhi/core';
import { getMinistrySummary } from '@nidhi/db';
import { OG_CONTENT_TYPE, OG_SIZE, formatCardDate, renderShareCard } from '@/lib/og-card';
import { getDataMode, resolveFy } from '@/lib/site';
import { strings } from '@/lib/strings';

/**
 * Per-ministry share card.
 *
 * This is the one docs/06 expects to travel: a journalist pastes a ministry
 * link into a story or a group, and the pace gauge goes with it.
 */

export const alt = `${strings.site.name}: ministry allocation, expenditure and spending pace`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

const FISCAL_LABELS = {
  authority: strings.stage.authority,
  spent: strings.stage.spent,
  balance: strings.stage.balance,
};

const fiscalPaceCaption = ({ spent, reference }: { spent: string; reference: string }) =>
  `${spent} spent, ${reference} of the year elapsed`;

export default async function MinistryOpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Tolerates the database being unreachable, exactly as loadChrome does: a
  // build in CI has no database, and a production blip should still unfurl a
  // card that says the figures are unavailable rather than fail the request.
  const dataMode = await getDataMode().catch(() => 'demo' as const);

  try {
    const { id } = await params;
    const { fy } = await resolveFy();
    const ministry = await getMinistrySummary(fy, id);
    if (ministry) {
      return renderShareCard({
        eyebrow: `${ministry.sector ?? 'Union budget'} · ${formatFiscalYearLong(fy)}`,
        title: ministry.name,
        authority: ministry.currentAuthority,
        spent: ministry.expenditureToDate,
        balance: ministry.balance,
        burn: ministry.burn,
        asOf: formatCardDate(ministry.expenditureAsOf),
        dataMode,
        labels: FISCAL_LABELS,
        paceCaption: fiscalPaceCaption,
      });
    }
  } catch (error) {
    console.error('[og] ministry card could not load figures', error);
  }

  return renderShareCard({
    eyebrow: strings.site.name,
    title: strings.ministries.emptyTitle,
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
