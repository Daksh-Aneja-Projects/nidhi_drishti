import type { Amount, BurnMetrics, Provenance } from '@nidhi/core';
import { Figure } from '@/components/figure';
import { PaceTrack } from '@/components/pace-track';
import { formatIstDate } from '@/lib/format';
import { getLocale, getStrings } from '@/lib/i18n-server';

/**
 * The headline record: three figures and the hero pace track, in one ruled band.
 *
 * This is the most shareable object in the product, so it carries everything a
 * screenshot of it would need to stand on its own: the three stages, the pace
 * against the calendar, and above all the date the expenditure figure covers.
 * Without that date the whole comparison is unreadable, which is why it is set
 * as a stamp rather than tucked into a caption.
 */

interface HeroPaceProps {
  entityId: string;
  authority: Amount;
  spent: Amount;
  balance: Amount;
  burn: BurnMetrics;
  /** Period end of the latest cumulative expenditure fact. */
  asOf: string | null;
  authorityProvenance: Provenance | null;
  expenditureProvenance: Provenance | null;
  /** `auto` switches to lakh crore for national scale figures. */
  unit?: 'crore' | 'lakh_crore' | 'auto';
  label?: string;
}

export async function HeroPace({
  entityId,
  authority,
  spent,
  balance,
  burn,
  asOf,
  authorityProvenance,
  expenditureProvenance,
  unit = 'auto',
  label,
}: HeroPaceProps) {
  const [strings, locale] = await Promise.all([getStrings(), getLocale()]);
  return (
    <section className="border-y-2 border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper-raised)]">
      <div className="grid gap-x-10 gap-y-8 px-4 py-7 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div>
          <p className="eyebrow mb-2">{strings.stage.authority}</p>
          <Figure
            value={authority}
            unit={unit}
            scale="hero"
            provenance={authorityProvenance}
            metric={strings.stage.authority}
            entityId={entityId}
            stage="RE"
          />
          <p className="mt-2.5 max-w-[46ch] text-[13px] leading-snug text-[color:var(--color-ink-faint)]">
            {strings.stage.authorityHelp}
          </p>

          <dl className="register mt-6 border-t border-[color:var(--color-rule)]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
              <dt className="eyebrow">{strings.stage.spent}</dt>
              <dd>
                <Figure
                  value={spent}
                  unit={unit}
                  scale="lead"
                  provenance={expenditureProvenance}
                  metric={strings.stage.spent}
                  entityId={entityId}
                  stage="EXPENDITURE"
                />
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
              <dt className="eyebrow">{strings.stage.balance}</dt>
              <dd>
                <Figure
                  value={balance}
                  unit={unit}
                  scale="lead"
                  provenance={authorityProvenance}
                  metric={strings.stage.balance}
                  entityId={entityId}
                />
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex flex-col justify-center">
          {/* The anchor date, set as a stamp. Everything to the right of it is
              a comparison that only means something on this date. */}
          <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-l-2 border-[color:var(--color-seal)] pl-3">
            <span className="eyebrow" style={{ color: 'var(--color-seal)' }}>
              {strings.overview.asOfLabel}
            </span>
            <span className="figure text-lg font-medium">
              {asOf ? formatIstDate(asOf, locale) : strings.common.notStated}
            </span>
          </div>

          <p className="eyebrow mb-2">{strings.pace.label}</p>
          <PaceTrack burn={burn} size="hero" label={label} />

          <p className="mt-4 max-w-[54ch] text-[13px] leading-relaxed text-[color:var(--color-ink-faint)]">
            {strings.pace.help}
          </p>
        </div>
      </div>
    </section>
  );
}
