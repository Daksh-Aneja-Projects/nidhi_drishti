import type { Metadata } from 'next';
import { ClipboardCheck } from 'lucide-react';
import { listFlags } from '@nidhi/db';
import { ANOMALY_RULES, EVIDENCE_KIND_LABELS, type AnomalyFlag } from '@nidhi/core';
import {
  Callout,
  Chip,
  EmptyState,
  PageHeader,
  PageShell,
  Section,
} from '@/components/layout-primitives';
import { formatIstDateTime } from '@/lib/format';
import { hasInternalAccess } from '@/lib/api';
import { strings } from '@/lib/strings';
import { approveFlag, rejectFlag } from '@/app/admin/review/actions';

/**
 * The review queue (docs/05 A3).
 *
 * Nothing above the lowest severity reaches the public feed without a person
 * approving it, and the decision is recorded against the flag. The page shows
 * the rule's caveat beside the explanation, because the reviewer's job is to
 * check that the explanation stays inside what the rule can actually support.
 *
 * Gated on the same shared secret as the operations view, and it queries
 * nothing when the token does not match.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: strings.admin.reviewTitle,
  robots: { index: false, follow: false },
};

function MetricList({ flag }: { flag: AnomalyFlag }) {
  const entries = Object.entries(flag.metric);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="figure text-[color:var(--color-ink-faint)]">{key}</dt>
          <dd className="figure">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function AdminReviewPage() {
  if (!(await hasInternalAccess())) {
    return (
      <PageShell>
        <div className="mx-auto max-w-2xl py-16">
          <EmptyState
            title={strings.admin.unavailableTitle}
            body={strings.admin.unavailableBody}
            action={{ href: '/', label: strings.nav.overview }}
          />
        </div>
      </PageShell>
    );
  }

  let pending: AnomalyFlag[] = [];
  let unavailable = false;
  try {
    pending = await listFlags({ status: 'pending', limit: 100 });
  } catch (error) {
    console.error('[admin] could not read the review queue', error);
    unavailable = true;
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={strings.admin.reviewEyebrow}
        title={strings.admin.reviewTitle}
        lede={strings.admin.reviewLede}
      />

      {unavailable ? (
        <Callout tone="caution">
          <p>{strings.ops.unavailable}</p>
        </Callout>
      ) : null}

      <Section title={strings.flags.reviewPending}>
        {pending.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title={strings.admin.queueEmpty}
            body={strings.admin.queueEmptyBody}
            action={{ href: '/ops', label: strings.ops.title }}
          />
        ) : (
          <div>
            {pending.map((flag) => {
              const rule = ANOMALY_RULES[flag.ruleId];
              return (
                <article key={flag.flagId} className="band-strong py-6">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h2 className="font-display text-[15px]">{flag.entityName}</h2>
                    <Chip tone="seal">{flag.severity}</Chip>
                    <Chip tone="muted">{flag.fy}</Chip>
                    <span className="text-[12px] text-[color:var(--color-ink-faint)]">
                      {strings.admin.raised} {formatIstDateTime(flag.createdAt)}
                    </span>
                  </div>

                  <p className="eyebrow mt-3">{rule.label}</p>
                  <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-[color:var(--color-ink-soft)]">
                    {flag.explanation}
                  </p>

                  <div className="mt-3 max-w-[70ch]">
                    <Callout tone="caution" title={strings.flags.doesNotProve}>
                      <p>{rule.doesNotProve}</p>
                    </Callout>
                  </div>

                  <p className="eyebrow mt-4">{strings.admin.metric}</p>
                  <MetricList flag={flag} />

                  {flag.evidence.length > 0 ? (
                    <>
                      <p className="eyebrow mt-4">{strings.admin.evidence}</p>
                      <ul className="mt-1 space-y-1">
                        {flag.evidence.map((item) => (
                          <li key={item.evidenceId} className="text-[13px]">
                            <span className="text-[color:var(--color-ink-faint)]">
                              {EVIDENCE_KIND_LABELS[item.kind]}:{' '}
                            </span>
                            {item.url ? (
                              <a
                                href={item.url}
                                rel="noopener noreferrer nofollow"
                                target="_blank"
                                className="underline underline-offset-2"
                              >
                                {item.title}
                              </a>
                            ) : (
                              item.title
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  <form className="mt-5 flex flex-wrap items-end gap-3">
                    <input type="hidden" name="flagId" value={flag.flagId} />
                    <label className="block flex-1 min-w-[16rem]">
                      <span className="eyebrow mb-1.5 block">{strings.admin.noteLabel}</span>
                      <input
                        type="text"
                        name="note"
                        placeholder={strings.admin.notePlaceholder}
                        className="w-full border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper)] px-3 py-2 text-[13px]"
                      />
                    </label>
                    <button
                      type="submit"
                      formAction={approveFlag}
                      className="border border-[color:var(--color-ink)] bg-[color:var(--color-ink)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-paper)]"
                    >
                      {strings.admin.approve}
                    </button>
                    <button
                      type="submit"
                      formAction={rejectFlag}
                      className="border border-[color:var(--color-rule-strong)] px-4 py-2 text-[13px] font-medium"
                    >
                      {strings.admin.reject}
                    </button>
                  </form>
                </article>
              );
            })}
          </div>
        )}
      </Section>
    </PageShell>
  );
}
