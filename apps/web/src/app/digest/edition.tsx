import { CalendarDays, Rss } from 'lucide-react';
import { EvidenceTimeline } from '@/components/evidence-timeline';
import { Icon } from '@/components/icon';
import { FlagCard } from '@/components/flag-card';
import { Callout, EmptyState, PageHeader, PageShell, Section } from '@/components/layout-primitives';
import { Link } from '@/components/locale-link';
import type { DigestEdition } from '@/lib/digest';
import { formatIstDate } from '@/lib/format';
import { getLocale, getStrings } from '@/lib/i18n-server';

/**
 * One digest edition, rendered.
 *
 * Shared by `/digest` and `/digest/[date]` so the two addresses cannot drift
 * into showing the same day differently. It lives beside the routes rather than
 * in `components/` because it is the shape of this one surface and nothing else
 * composes it.
 *
 * It makes no claim of its own. Signals go through `FlagCard`, which reads the
 * "what this does not establish" line out of the rule catalogue itself, and
 * evidence goes through `EvidenceTimeline`, which carries its own tier two
 * caveat. Both caveats are therefore structural here as well.
 *
 * There is no money figure on this page and that is deliberate: a digest that
 * totalled anything would be making a claim nobody reviewed. Every number a
 * reader sees is inside a signal card, next to the rule that measured it.
 */

export async function DigestEditionView({
  edition,
  recentDays,
  isToday,
}: {
  edition: DigestEdition;
  recentDays: readonly string[];
  isToday: boolean;
}) {
  const [strings, locale] = await Promise.all([getStrings(), getLocale()]);
  const dayLabel = formatIstDate(edition.day, locale);

  return (
    <PageShell>
      <PageHeader
        eyebrow={isToday ? strings.digest.todayTitle : strings.digest.dateLabel}
        title={strings.digest.title}
        lede={strings.digest.lede}
      />

      <p className="eyebrow mb-6">
        {strings.digest.dateLabel}: {dayLabel}
      </p>

      {edition.degraded ? (
        // An unreachable store and a quiet day are different facts and must not
        // render the same way. Nothing is estimated in either case.
        <EmptyState
          icon={CalendarDays}
          title={strings.digest.unavailable}
          body={strings.digest.unavailableBody}
          action={{ href: '/flags', label: strings.nav.flags }}
        />
      ) : edition.isQuiet ? (
        <EmptyState
          icon={CalendarDays}
          title={strings.digest.quietTitle}
          body={strings.digest.quietBody}
          action={{ href: '/flags', label: strings.nav.flags }}
        />
      ) : (
        <>
          {edition.flags.length > 0 ? (
            <Section title={strings.digest.signalsTitle} help={strings.digest.signalsHelp}>
              <p className="eyebrow mb-2">
                {edition.flags.length} {strings.digest.signalsCounted}
              </p>
              <div>
                {edition.flags.map((flag) => (
                  <FlagCard key={flag.flagId} flag={flag} />
                ))}
              </div>
            </Section>
          ) : null}

          {edition.evidence.length > 0 ? (
            <Section title={strings.digest.evidenceTitle} help={strings.digest.evidenceHelp}>
              <p className="eyebrow mb-2">
                {edition.evidence.length} {strings.digest.evidenceCounted}
              </p>
              <EvidenceTimeline items={edition.evidence} />
            </Section>
          ) : null}
        </>
      )}

      <Section title={strings.digest.recentTitle} help={strings.digest.recentHelp}>
        {recentDays.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-ink-faint)]">
            {strings.digest.recentEmpty}
          </p>
        ) : (
          <ul className="list-none">
            {recentDays.map((day) => (
              <li key={day} className="band py-2.5">
                <Link
                  href={`/digest/${day}`}
                  className="figure text-[13px] underline decoration-[color:var(--color-rule-strong)] underline-offset-2 hover:decoration-[color:var(--color-ink)]"
                  aria-current={day === edition.day ? 'page' : undefined}
                >
                  {formatIstDate(day, locale)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="mt-10">
        <Callout title={strings.digest.subscribeTitle}>
          <p>{strings.digest.subscribeBody}</p>
          <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href="/feed.xml"
              className="inline-flex items-baseline gap-1.5 border-b border-[color:var(--color-behind)] pb-0.5 font-medium text-[color:var(--color-behind)]"
            >
              <Icon icon={Rss} size="xs" />
              {strings.digest.subscribeLink}
            </a>
            <a
              href="/feed/flags.xml"
              className="inline-flex items-baseline gap-1.5 border-b border-[color:var(--color-behind)] pb-0.5 font-medium text-[color:var(--color-behind)]"
            >
              <Icon icon={Rss} size="xs" />
              {strings.digest.subscribeFlagsLink}
            </a>
          </p>
        </Callout>
      </div>
    </PageShell>
  );
}
