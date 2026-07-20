import { ExternalLink } from 'lucide-react';
import {
  EVIDENCE_KIND_LABELS,
  formatINRCr,
  isNotReported,
  type EvidenceItem,
  type Tender,
} from '@nidhi/core';
import { Icon } from '@/components/icon';
import { Callout, Chip, EmptyState } from '@/components/layout-primitives';
import { getLocale, getStrings } from '@/lib/i18n-server';
import type { Strings } from '@/lib/strings';
import { formatIstDate } from '@/lib/format';

/**
 * The evidence stream: press releases, parliament answers, reporting, and
 * tender notices, on one dated timeline.
 *
 * Everything on this timeline is Tier 2. It is observable activity around an
 * entity, matched by name, and it is never a fiscal figure. The caveat is built
 * into the component rather than left to each page, so a timeline cannot be
 * dropped onto a screen without the sentence that keeps it honest.
 *
 * Each entry carries a stable anchor id so a citation chip in an AI narrative
 * can link straight to the item it cites, with no JavaScript involved.
 */

export function evidenceAnchor(evidenceId: number): string {
  return `evidence-${evidenceId}`;
}

export function tenderAnchor(tenderId: string): string {
  return `tender-${tenderId}`;
}

interface Entry {
  anchor: string;
  date: string | null;
  kindLabel: string;
  title: string;
  url: string | null;
  detail: string | null;
  isTender: boolean;
}

function toEntries(
  items: readonly EvidenceItem[],
  tenders: readonly Tender[],
  strings: Strings,
): Entry[] {
  const fromEvidence: Entry[] = items.map((item) => ({
    anchor: evidenceAnchor(item.evidenceId),
    date: item.publishedDate,
    kindLabel: EVIDENCE_KIND_LABELS[item.kind],
    title: item.title,
    url: item.url,
    detail: item.summary,
    isTender: false,
  }));

  const fromTenders: Entry[] = tenders.map((tender) => ({
    anchor: tenderAnchor(tender.tenderId),
    date: tender.publishedDate,
    kindLabel: strings.tenders.title,
    title: tender.title,
    url: tender.url,
    detail: isNotReported(tender.valueInrCr)
      ? tender.orgRaw
      : `${tender.orgRaw}. ${formatINRCr(tender.valueInrCr)}`,
    isTender: true,
  }));

  // Undated items sort last rather than being dropped: an item with no stated
  // date is still evidence, and hiding it would quietly narrow the record.
  return [...fromEvidence, ...fromTenders].sort((a, b) => {
    if (a.date === b.date) return 0;
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? 1 : -1;
  });
}

export async function EvidenceTimeline({
  items = [],
  tenders = [],
  emptyBody,
  showCaveat = true,
}: {
  items?: readonly EvidenceItem[];
  tenders?: readonly Tender[];
  emptyBody?: string;
  showCaveat?: boolean;
}) {
  const [strings, locale] = await Promise.all([getStrings(), getLocale()]);
  const entries = toEntries(items, tenders, strings);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={ExternalLink}
        title={strings.evidence.empty}
        body={emptyBody ?? strings.evidence.tier2Note}
      />
    );
  }

  return (
    <div>
      {showCaveat ? (
        <Callout tone="caution" title={strings.evidence.tier2Title}>
          {strings.evidence.tier2Note}
        </Callout>
      ) : null}

      <ol className="mt-4 list-none border-l border-[color:var(--color-rule-strong)] pl-0">
        {entries.map((entry) => (
          <li key={entry.anchor} id={entry.anchor} className="relative py-3 pl-5 target:bg-[color:var(--color-paper-raised)]">
            <span
              aria-hidden="true"
              className="absolute left-0 top-[1.35rem] h-px w-3 bg-[color:var(--color-rule-strong)]"
            />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="figure text-[11px] text-[color:var(--color-ink-faint)]">
                {entry.date ? formatIstDate(entry.date, locale) : strings.evidence.undated}
              </span>
              <Chip tone={entry.isTender ? 'muted' : 'neutral'}>{entry.kindLabel}</Chip>
            </div>

            <p className="mt-1 text-[14px] leading-snug">
              {entry.url ? (
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-baseline gap-1 text-[color:var(--color-ink)] underline decoration-[color:var(--color-rule-strong)] underline-offset-2 hover:decoration-[color:var(--color-ink)]"
                >
                  {entry.title}
                  <Icon icon={ExternalLink} size="xs" className="text-[color:var(--color-ink-faint)]" />
                </a>
              ) : (
                entry.title
              )}
            </p>

            {entry.detail ? (
              <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-[color:var(--color-ink-faint)]">
                {entry.detail}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
