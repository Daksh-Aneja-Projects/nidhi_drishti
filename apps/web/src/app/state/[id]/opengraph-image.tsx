import { NOT_REPORTED, formatFiscalYearLong } from '@nidhi/core';
import { getStateSummary } from '@nidhi/db';
import { OG_CONTENT_TYPE, OG_SIZE, formatCardDate, renderShareCard } from '@/lib/og-card';
import { getDataMode, resolveFy } from '@/lib/site';
import { strings } from '@/lib/strings';

/**
 * Per-state share card.
 *
 * A state reports the same fiscal stages as a ministry, so the card reuses the
 * fiscal labels and the calendar comparison unchanged. The eyebrow names the
 * jurisdiction, because a screenshot of a state figure travelling without the
 * word "state" attached is exactly how the two ledgers get summed by accident.
 */

export const alt = `${strings.site.name}: state allocation, expenditure and spending pace`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

const FISCAL_LABELS = {
  authority: strings.stage.authority,
  spent: strings.stage.spent,
  balance: strings.stage.balance,
};

const fiscalPaceCaption = ({ spent, reference }: { spent: string; reference: string }) =>
  `${spent} spent, ${reference} of the year elapsed`;

export default async function StateOpengraphImage({
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
    const state = await getStateSummary(fy, id);
    if (state) {
      const kindLabel = state.kind === 'ut' ? strings.states.kindUt : strings.states.kindState;

      return renderShareCard({
        eyebrow: `${kindLabel} budget · ${formatFiscalYearLong(fy)}`,
        title: state.name,
        authority: state.currentAuthority,
        spent: state.expenditureToDate,
        balance: state.balance,
        burn: state.burn,
        asOf: formatCardDate(state.expenditureAsOf),
        dataMode,
        labels: FISCAL_LABELS,
        paceCaption: fiscalPaceCaption,
      });
    }
  } catch (error) {
    console.error('[og] state card could not load figures', error);
  }

  return renderShareCard({
    eyebrow: strings.site.name,
    title: strings.state.emptyTitle,
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
