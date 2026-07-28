import { FileQuestion } from 'lucide-react';
import { Icon } from '@/components/icon';
import { Link } from '@/components/locale-link';

/**
 * One statement, where an entity has no figures at all for the year.
 *
 * The alternative was what this replaces: the full set of panels rendered with
 * every figure reading "Not reported". On a scheme with nothing ingested that
 * put seven separate "Not reported" labels on one screen, across a chart, three
 * figure cards and two callouts, and the effect was the opposite of the
 * intention. Repeated absence stops reading as rigour and starts reading as a
 * broken page.
 *
 * The honesty is not negotiable, so it is not being traded away here, only
 * consolidated. Saying it once, plainly, with the reason and a route to the
 * coverage page, is a stronger claim than saying it seven times in a layout
 * that looks like it failed to load. Where an entity has some figures, the
 * panels render as before and individual gaps still say "Not reported" next to
 * the figures that are present, which is where that label does its work.
 */

export function NoFiguresNotice({
  title,
  body,
  sourcesLabel,
}: {
  title: string;
  body: string;
  sourcesLabel: string;
}) {
  return (
    <section className="my-6 rounded-[var(--radius-md)] border border-[color:var(--color-rule)] bg-[color:var(--color-surface-inset)] px-5 py-5">
      <div className="flex gap-3">
        <Icon
          icon={FileQuestion}
          size="sm"
          className="mt-0.5 shrink-0 text-[color:var(--color-ink-faint)]"
        />
        <div>
          <p className="text-[14px] font-medium text-[color:var(--color-ink)]">{title}</p>
          <p className="mt-1.5 max-w-[70ch] text-[13px] leading-relaxed text-[color:var(--color-ink-soft)]">
            {body}
          </p>
          <Link
            href="/sources"
            className="mt-3 inline-block text-[13px] text-[color:var(--color-accent)] underline underline-offset-4"
          >
            {sourcesLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
