'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, Link2, X } from 'lucide-react';
import {
  EXTRACTION_METHOD_LABELS,
  FISCAL_STAGE_DESCRIPTIONS,
  FISCAL_STAGE_LABELS,
  type FiscalStage,
  type Provenance,
} from '@nidhi/core';
import { Icon } from '@/components/icon';
import { track } from '@/lib/analytics';
import { strings } from '@/lib/strings';
import { formatIstDate, formatIstDateTime } from '@/lib/format';

/**
 * The provenance affordance behind every figure on the site.
 *
 * CLAUDE.md principle 3 makes this non-optional: a number with no way to reach
 * its source is not publishable. It is deliberately a real popover rather than
 * a title attribute, because journalists need the document link and the fetch
 * timestamp, and because opening it is the trust metric the product tracks
 * (docs/09 dashboard 2).
 */

interface ProvenancePopoverProps {
  provenance: Provenance | null;
  /** Which figure this is attached to, for the analytics event. */
  metric: string;
  entityId: string;
  stage?: FiscalStage;
  children: React.ReactNode;
}

export function ProvenancePopover({
  provenance,
  metric,
  entityId,
  stage,
  children,
}: ProvenancePopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      track('provenance_opened', {
        metric,
        entity_id: entityId,
        source_id: provenance?.sourceId ?? 'none',
      });
    }
  }

  return (
    <span className="relative inline-flex items-baseline gap-1" ref={containerRef}>
      {children}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={`${strings.provenance.trigger}: ${metric}`}
        className="translate-y-[-2px] cursor-pointer border-b border-dotted border-[color:var(--color-seal)] px-0.5 text-[10px] font-medium uppercase tracking-wider text-[color:var(--color-seal)] transition-opacity hover:opacity-70"
      >
        {strings.provenance.trigger}
      </button>

      {open ? (
        <span
          role="dialog"
          aria-label={strings.provenance.title}
          className="absolute left-0 top-full z-50 mt-2 block w-[min(22rem,calc(100vw-2rem))] border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper-raised)] p-4 text-left shadow-[0_8px_24px_rgba(22,32,43,0.12)]"
        >
          <span className="mb-3 flex items-start justify-between gap-3">
            <span className="eyebrow">{strings.provenance.title}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="cursor-pointer text-[color:var(--color-ink-faint)] hover:text-[color:var(--color-ink)]"
            >
              <Icon icon={X} size="sm" />
            </button>
          </span>

          {provenance ? (
            <dl className="space-y-2 text-[13px] leading-snug">
              {stage ? (
                <ProvenanceRow label={strings.provenance.stage}>
                  <span className="font-medium">{FISCAL_STAGE_LABELS[stage]}</span>
                  <span className="mt-0.5 block text-[color:var(--color-ink-faint)]">
                    {FISCAL_STAGE_DESCRIPTIONS[stage]}
                  </span>
                </ProvenanceRow>
              ) : null}

              <ProvenanceRow label={strings.provenance.source}>
                {provenance.sourceName}
              </ProvenanceRow>

              <ProvenanceRow label={strings.provenance.documentDate}>
                {provenance.documentDate ? formatIstDate(provenance.documentDate) : 'Not stated'}
              </ProvenanceRow>

              <ProvenanceRow label={strings.provenance.fetched}>
                {formatIstDateTime(provenance.fetchedAt)}
              </ProvenanceRow>

              <ProvenanceRow label={strings.provenance.method}>
                {EXTRACTION_METHOD_LABELS[provenance.extractionMethod]}
              </ProvenanceRow>

              {provenance.isProvisional ? (
                <span className="mt-3 flex gap-2 border-l-2 border-[color:var(--color-seal)] bg-[color:var(--color-paper-sunk)] px-3 py-2 text-[12px] text-[color:var(--color-ink-soft)]">
                  {strings.provenance.provisional}
                </span>
              ) : null}

              {provenance.url ? (
                <a
                  href={provenance.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-3 inline-flex items-center gap-1.5 border-b border-[color:var(--color-behind)] pb-0.5 text-[13px] font-medium text-[color:var(--color-behind)]"
                >
                  <Icon icon={Link2} size="sm" />
                  {strings.provenance.openSource}
                </a>
              ) : null}

              {provenance.artifactKey ? (
                <span className="mt-2 flex items-center gap-1.5 text-[11px] text-[color:var(--color-ink-faint)]">
                  <Icon icon={FileText} size="xs" />
                  {strings.provenance.artifact}: {provenance.artifactKey}
                </span>
              ) : null}
            </dl>
          ) : (
            <p className="text-[13px] text-[color:var(--color-ink-soft)]">
              {strings.provenance.missing}
            </p>
          )}
        </span>
      ) : null}
    </span>
  );
}

function ProvenanceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="block">
      <dt className="eyebrow mb-0.5">{label}</dt>
      <dd className="text-[color:var(--color-ink)]">{children}</dd>
    </span>
  );
}
