import {
  formatINRAuto,
  formatINRCr,
  formatINRLakhCr,
  isNotReported,
  type Amount,
  type FiscalStage,
  type Provenance,
} from '@nidhi/core';
import { ProvenancePopover } from '@/components/provenance';
import { getStrings } from '@/lib/i18n-server';

/**
 * A rupee figure with its provenance attached.
 *
 * There is no way to render a money value in this app without passing the
 * provenance alongside it. That is the point: principle 3 says every displayed
 * number has a source affordance, and the cheapest way to guarantee it is to
 * make the component that draws the number also draw the link to its evidence.
 *
 * An unreported figure renders as the words "Not reported" in the absence tone,
 * never as a zero and never as a dash that could be read as nil.
 */

export type FigureScale = 'hero' | 'lead' | 'body' | 'dense';

const SCALE_CLASSES: Record<FigureScale, string> = {
  // Bigger and tighter than a normal display figure. This is the one number
  // the page exists to state, and the unit rides with it on one line: an
  // orphaned "cr" on its own row makes the largest figure on the site look
  // like a layout accident.
  hero: 'text-[clamp(2.5rem,7vw,4.5rem)] font-medium leading-[0.95] tracking-[-0.035em] text-balance',
  lead: 'text-2xl font-medium leading-tight',
  body: 'text-base font-medium',
  dense: 'text-[13px]',
};

interface FigureProps {
  value: Amount;
  /** `auto` switches to lakh crore above the threshold, for national figures. */
  unit?: 'crore' | 'lakh_crore' | 'auto';
  scale?: FigureScale;
  provenance?: Provenance | null;
  /** Name of the metric, used for the provenance popover and its analytics event. */
  metric?: string;
  entityId?: string;
  stage?: FiscalStage;
  signed?: boolean;
  className?: string;
}

function formatValue(value: Amount, unit: FigureProps['unit'], signed: boolean): string {
  const options = { signed };
  if (unit === 'lakh_crore') return formatINRLakhCr(value, options);
  if (unit === 'auto') return formatINRAuto(value, options);
  return formatINRCr(value, options);
}

export async function Figure({
  value,
  unit = 'crore',
  scale = 'body',
  provenance,
  metric,
  entityId,
  stage,
  signed = false,
  className = '',
}: FigureProps) {
  const strings = await getStrings();
  const unreported = isNotReported(value);
  const text = formatValue(value, unit, signed);

  const rendered = (
    <span
      className={`figure ${SCALE_CLASSES[scale]} ${className}`}
      style={unreported ? { color: 'var(--color-unreported)' } : undefined}
      title={unreported ? strings.common.notReportedHelp : undefined}
    >
      {text}
    </span>
  );

  // A figure with no provenance to show gets no trigger, rather than a trigger
  // that opens onto nothing.
  if (!metric || !entityId || provenance === undefined) return rendered;

  return (
    <ProvenancePopover provenance={provenance} metric={metric} entityId={entityId} stage={stage}>
      {rendered}
    </ProvenancePopover>
  );
}

/**
 * A labelled figure, the unit the whole product is built from: eyebrow label,
 * the figure, and an optional note beneath.
 */
export function FigureBlock({
  label,
  value,
  note,
  ...figureProps
}: FigureProps & { label: string; note?: string }) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{label}</p>
      <Figure value={value} {...figureProps} />
      {note ? (
        <p className="mt-1.5 text-xs leading-snug text-[color:var(--color-ink-faint)]">{note}</p>
      ) : null}
    </div>
  );
}
