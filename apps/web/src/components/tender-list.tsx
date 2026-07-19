import { ExternalLink, PackageSearch } from 'lucide-react';
import type { Confidence, Tender, TenderStatus } from '@nidhi/core';
import { Figure } from '@/components/figure';
import { Icon } from '@/components/icon';
import { Callout, Chip, EmptyState, TableScroll } from '@/components/layout-primitives';
import { formatIstDate } from '@/lib/format';
import { strings } from '@/lib/strings';

/**
 * Linked tender notices.
 *
 * Tenders are Tier 2. They are published procurement activity, matched to an
 * entity by name, and a tender value is emphatically not government
 * expenditure. Both facts are stated by the component itself, above the table,
 * so no page can render this list without them. The match confidence is shown
 * per row for the same reason: an imperfect match should be visible as an
 * imperfect match rather than presented as a fact.
 */

const STATUS_LABELS: Record<TenderStatus, string> = {
  published: strings.tenders.statusPublished,
  awarded: strings.tenders.statusAwarded,
  cancelled: strings.tenders.statusCancelled,
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: strings.verification.confidenceHigh,
  medium: strings.verification.confidenceMedium,
  low: strings.verification.confidenceLow,
};

export function TenderList({
  tenders,
  emptyBody,
}: {
  tenders: readonly Tender[];
  emptyBody?: string;
}) {
  if (tenders.length === 0) {
    return (
      <EmptyState
        icon={PackageSearch}
        title={strings.tenders.empty}
        body={emptyBody ?? strings.tenders.tier2Note}
      />
    );
  }

  return (
    <div>
      <Callout tone="caution" title={strings.tenders.tier2Title}>
        {strings.tenders.tier2Note}
      </Callout>

      <TableScroll>
        <table className="data-table mt-4">
          <thead>
            <tr>
              <th scope="col">{strings.tenders.columnDate}</th>
              <th scope="col">{strings.tenders.columnTitle}</th>
              <th scope="col">{strings.tenders.columnOrg}</th>
              <th scope="col" className="num">
                {strings.tenders.columnValue}
              </th>
              <th scope="col">{strings.tenders.columnStatus}</th>
            </tr>
          </thead>
          <tbody>
            {tenders.map((tender) => (
              <tr key={tender.tenderId}>
                <td className="whitespace-nowrap text-[13px] text-[color:var(--color-ink-faint)]">
                  {tender.publishedDate ? formatIstDate(tender.publishedDate) : strings.evidence.undated}
                </td>
                <td className="min-w-[18rem] max-w-[32rem]">
                  {tender.url ? (
                    <a
                      href={tender.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-baseline gap-1 underline decoration-[color:var(--color-rule-strong)] underline-offset-2 hover:decoration-[color:var(--color-ink)]"
                    >
                      {tender.title}
                      <Icon
                        icon={ExternalLink}
                        size="xs"
                        className="text-[color:var(--color-ink-faint)]"
                      />
                    </a>
                  ) : (
                    tender.title
                  )}
                  {tender.matchConfidence ? (
                    <span className="mt-1 block">
                      <Chip tone="muted">
                        {strings.tenders.match}: {CONFIDENCE_LABELS[tender.matchConfidence]}
                      </Chip>
                    </span>
                  ) : null}
                </td>
                <td className="text-[13px] text-[color:var(--color-ink-soft)]">{tender.orgRaw}</td>
                <td className="num">
                  {/* No provenance popover: a tender carries no fiscal source
                      record, and inventing one would be a fabricated citation.
                      The notice itself is linked in the row instead. */}
                  <Figure value={tender.valueInrCr} scale="dense" />
                </td>
                <td className="text-[13px]">
                  <Chip tone={tender.status === 'cancelled' ? 'muted' : 'neutral'}>
                    {STATUS_LABELS[tender.status]}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}
