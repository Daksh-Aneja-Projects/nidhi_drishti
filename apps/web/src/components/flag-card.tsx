'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import {
  ANOMALY_RULES,
  EVIDENCE_KIND_LABELS,
  formatFiscalYearShort,
  formatINRCr,
  type AnomalyFlag,
  type Severity,
} from '@nidhi/core';
import { Icon } from '@/components/icon';
import { Link } from '@/components/locale-link';
import { useLocale, useStrings } from '@/components/locale-provider';
import { Callout, Chip } from '@/components/layout-primitives';
import { track } from '@/lib/analytics';
import { formatIstDate } from '@/lib/format';

/**
 * A signal card.
 *
 * docs/06 P4 and docs/08 section 2 require five things on every one of these:
 * the rule and its severity, a visual of the numbers that triggered it, the
 * plain-language explanation, links to the evidence, and the line stating what
 * the signal does not establish.
 *
 * That last line is the credibility armour, and it is the one most likely to be
 * dropped by a page author under layout pressure. So it is not a prop and it is
 * not the page's job: the card reads it out of ANOMALY_RULES itself, which
 * means the only way to publish a card without it is to delete this component.
 */

const SEVERITY_TONES: Record<Severity, 'neutral' | 'seal' | 'muted'> = {
  high: 'seal',
  notable: 'neutral',
  info: 'muted',
};

function entityHref(flag: AnomalyFlag): string {
  if (flag.entityType === 'ministry') return `/ministry/${flag.entityId}`;
  if (flag.entityType === 'scheme') return `/scheme/${flag.entityId}`;
  return '/';
}

function humaniseKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface MetricEntry {
  key: string;
  label: string;
  display: string;
  /** Fraction of the bar to fill, or null where the number is not a share. */
  fill: number | null;
}

/**
 * Read the rule-specific metric bag into something displayable.
 *
 * Deliberately conservative: only primitives are shown, units are inferred from
 * the key name, and anything that cannot be read confidently is printed as it
 * was stored rather than reinterpreted into a prettier number that might be
 * wrong.
 */
function readMetric(metric: Record<string, unknown>): MetricEntry[] {
  const entries: MetricEntry[] = [];
  for (const [key, raw] of Object.entries(metric)) {
    const lower = key.toLowerCase();
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      let display: string;
      let fill: number | null = null;
      if (lower.includes('pct') || lower.includes('percent') || lower.includes('share')) {
        display = `${raw.toFixed(1)}%`;
        fill = Math.max(0, Math.min(1, raw / 100));
      } else if (lower.includes('ratio')) {
        display = raw.toFixed(2);
        fill = Math.max(0, Math.min(1, raw / 2));
      } else if (lower.includes('cr') || lower.includes('amount') || lower.includes('value')) {
        display = formatINRCr(raw, { decimals: 0 });
      } else {
        display = raw.toLocaleString('en-IN');
      }
      entries.push({ key, label: humaniseKey(key), display, fill });
    } else if (typeof raw === 'string' && raw.length > 0 && raw.length < 80) {
      entries.push({ key, label: humaniseKey(key), display: raw, fill: null });
    }
  }
  return entries;
}

export function FlagCard({ flag }: { flag: AnomalyFlag }) {
  const strings = useStrings();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const rule = ANOMALY_RULES[flag.ruleId];
  const metrics = readMetric(flag.metric);
  const headline = metrics.slice(0, 3);
  const rest = metrics.slice(3);
  const severityLabels: Record<Severity, string> = {
    high: strings.flags.severityHigh,
    notable: strings.flags.severityNotable,
    info: strings.flags.severityInfo,
  };

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      track('flag_card_opened', {
        rule_id: flag.ruleId,
        severity: flag.severity,
        entity_id: flag.entityId,
      });
    }
  }

  return (
    <article className="band-strong py-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Chip tone={SEVERITY_TONES[flag.severity]}>{severityLabels[flag.severity]}</Chip>
            <span className="eyebrow">{formatFiscalYearShort(flag.fy)}</span>
            {flag.status === 'pending' ? <Chip tone="muted">{strings.flags.reviewPending}</Chip> : null}
          </div>
          <h3 className="font-display text-lg leading-tight">{rule.label}</h3>
          <p className="mt-1 text-[13px] text-[color:var(--color-ink-soft)]">
            <Link
              href={entityHref(flag)}
              className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2 hover:decoration-[color:var(--color-ink)]"
            >
              {flag.entityName}
            </Link>
            <span className="mx-2 text-[color:var(--color-rule-strong)]">/</span>
            <span className="text-[color:var(--color-ink-faint)]">
              {formatIstDate(flag.createdAt, locale)}
            </span>
          </p>
        </div>

        <Link
          href={`/verify/${flag.entityType}/${flag.entityId}`}
          className="shrink-0 border-b border-[color:var(--color-behind)] pb-0.5 text-[13px] font-medium text-[color:var(--color-behind)]"
        >
          {strings.verification.title}
        </Link>
      </div>

      {/* The metric visual. Small, but it is the number that fired the rule. */}
      {headline.length > 0 ? (
        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-3">
          {headline.map((entry) => (
            <div key={entry.key}>
              <dt className="eyebrow mb-1">{entry.label}</dt>
              <dd className="figure text-base font-medium">{entry.display}</dd>
              {entry.fill === null ? null : (
                <dd
                  className="mt-1.5 h-1.5 w-full"
                  style={{ backgroundColor: 'var(--color-paper-sunk)' }}
                  aria-hidden="true"
                >
                  <span
                    className="block h-full"
                    style={{
                      width: `${entry.fill * 100}%`,
                      backgroundColor: 'var(--color-ink-soft)',
                    }}
                  />
                </dd>
              )}
            </div>
          ))}
        </dl>
      ) : null}

      <p className="mt-4 max-w-[68ch] text-[14px] leading-relaxed">{flag.explanation}</p>

      {/* Evidence, always on the card rather than behind the disclosure. */}
      <div className="mt-4">
        <p className="eyebrow mb-1.5">{strings.flags.evidence}</p>
        {flag.evidence.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-ink-faint)]">{strings.flags.noEvidence}</p>
        ) : (
          <ul className="space-y-1.5">
            {flag.evidence.map((item) => (
              <li key={item.evidenceId} className="text-[13px] leading-snug">
                <span className="text-[color:var(--color-ink-faint)]">
                  {EVIDENCE_KIND_LABELS[item.kind]}
                  <span className="mx-1.5">/</span>
                  {item.publishedDate
                    ? formatIstDate(item.publishedDate, locale)
                    : strings.evidence.undated}
                </span>{' '}
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-baseline gap-1 underline decoration-[color:var(--color-rule-strong)] underline-offset-2 hover:decoration-[color:var(--color-ink)]"
                  >
                    {item.title}
                    <Icon
                      icon={ExternalLink}
                      size="xs"
                      className="text-[color:var(--color-ink-faint)]"
                    />
                  </a>
                ) : (
                  item.title
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* docs/08: the line that keeps this a description rather than a charge. */}
      <div className="mt-4">
        <Callout tone="caution" title={strings.flags.doesNotProve}>
          {rule.doesNotProve}
        </Callout>
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="mt-3 inline-flex cursor-pointer items-center gap-1.5 text-[11px] uppercase tracking-wider text-[color:var(--color-ink-faint)] transition-colors hover:text-[color:var(--color-ink)]"
      >
        <Icon icon={open ? ChevronUp : ChevronDown} size="xs" />
        {open ? strings.flags.hideDetail : strings.flags.showDetail}
      </button>

      {open ? (
        <div className="mt-3 border-l-2 border-[color:var(--color-rule-strong)] pl-4">
          <p className="eyebrow mb-1">{strings.flags.rule}</p>
          <p className="max-w-[68ch] text-[13px] leading-relaxed text-[color:var(--color-ink-soft)]">
            {rule.description}
          </p>

          {rest.length > 0 || headline.length > 0 ? (
            <>
              <p className="eyebrow mb-1 mt-4">{strings.flags.measures}</p>
              <dl className="grid gap-x-8 gap-y-1.5 text-[13px] sm:grid-cols-2">
                {[...headline, ...rest].map((entry) => (
                  <div key={`detail-${entry.key}`} className="flex justify-between gap-4">
                    <dt className="text-[color:var(--color-ink-faint)]">{entry.label}</dt>
                    <dd className="figure">{entry.display}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
