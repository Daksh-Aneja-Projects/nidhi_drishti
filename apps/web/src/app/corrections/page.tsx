import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { CheckCircle, TriangleAlert } from 'lucide-react';
import { isFiscalYear } from '@nidhi/core';
import { query } from '@nidhi/db';
import { Callout, PageHeader, PageShell, Section } from '@/components/layout-primitives';
import { Icon } from '@/components/icon';
import { consumeRateLimit } from '@/lib/rate-limit';
import { strings } from '@/lib/strings';

/**
 * Report an error in a figure (docs/08 section 2).
 *
 * No account, no session, and the only optional personal detail is a contact
 * address the reporter chooses to give so that we can reply. The form is plain
 * HTML posting to a server action, so it works with scripting unavailable.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: strings.corrections.title,
  description: strings.corrections.lede,
};

const ENTITY_CHOICES = ['ministry', 'scheme', 'national'] as const;

function text(value: FormDataEntryValue | null, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function submitCorrection(formData: FormData): Promise<void> {
  'use server';

  const note = text(formData.get('note'), 4000);
  if (note.length === 0) redirect('/corrections?outcome=empty');

  const entityTypeRaw = text(formData.get('entityType'), 20);
  const entityType = (ENTITY_CHOICES as readonly string[]).includes(entityTypeRaw)
    ? entityTypeRaw
    : null;
  const entityId = text(formData.get('entityId'), 120) || null;
  const fyRaw = text(formData.get('fy'), 12);
  const fy = fyRaw && isFiscalYear(fyRaw) ? fyRaw : null;
  const contact = text(formData.get('contact'), 200);

  // The contact line is folded into the note because the corrections table
  // holds no contact column, and adding one would mean holding a personal
  // detail in its own indexed field for no operational gain.
  const reporterNote = contact ? `${note}\n\nContact given by the reporter: ${contact}` : note;

  let saved = false;
  try {
    const headerBag = await headers();
    const address =
      headerBag.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headerBag.get('x-real-ip')?.trim() ??
      'unknown';
    // A public unauthenticated write needs a ceiling, and the limiter degrades
    // to an in-process bucket rather than failing the submission.
    const allowance = await consumeRateLimit(`correction:${address}`, 5);
    if (!allowance.allowed) redirect('/corrections?outcome=failed');

    await query(
      `INSERT INTO correction (entity_type, entity_id, fy, reporter_note)
       VALUES ($1, $2, $3, $4)`,
      [entityType, entityId, fy, reporterNote],
    );
    saved = true;
  } catch (error) {
    // redirect() signals by throwing, so it must be allowed to propagate.
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    console.error('[corrections] could not record the report', error);
  }

  redirect(saved ? '/corrections?outcome=received' : '/corrections?outcome=failed');
}

export default async function CorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const outcomeRaw = params.outcome;
  const outcome = Array.isArray(outcomeRaw) ? outcomeRaw[0] : outcomeRaw;

  return (
    <PageShell>
      <PageHeader
        eyebrow={strings.corrections.eyebrow}
        title={strings.corrections.title}
        lede={strings.corrections.lede}
      />

      {outcome === 'received' ? (
        <div className="mb-8 flex items-start gap-3 border-l-2 border-[color:var(--color-onpace)] bg-[color:var(--color-paper-sunk)] px-4 py-3">
          <Icon icon={CheckCircle} size="lg" className="mt-0.5 text-[color:var(--color-onpace)]" />
          <div>
            <p className="font-display text-[15px]">{strings.corrections.successTitle}</p>
            <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-[color:var(--color-ink-soft)]">
              {strings.corrections.successBody}
            </p>
          </div>
        </div>
      ) : null}

      {outcome === 'empty' || outcome === 'failed' ? (
        <div className="mb-8 flex items-start gap-3 border-l-2 border-[color:var(--color-seal)] bg-[color:var(--color-paper-sunk)] px-4 py-3">
          <Icon icon={TriangleAlert} size="lg" className="mt-0.5 text-[color:var(--color-seal)]" />
          <div>
            <p className="font-display text-[15px]">
              {outcome === 'empty'
                ? strings.corrections.errorEmptyTitle
                : strings.corrections.errorFailedTitle}
            </p>
            <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-[color:var(--color-ink-soft)]">
              {outcome === 'empty'
                ? strings.corrections.errorEmptyBody
                : strings.corrections.errorFailedBody}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,34rem)_minmax(0,22rem)]">
        <Section title={strings.corrections.noteLabel} help={strings.corrections.noteHelp}>
          <form action={submitCorrection} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="eyebrow mb-1.5 block">{strings.corrections.entityTypeLabel}</span>
                <select
                  name="entityType"
                  defaultValue=""
                  className="w-full border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper)] px-3 py-2 text-[14px]"
                >
                  <option value="">{strings.corrections.entityTypeAny}</option>
                  <option value="ministry">{strings.common.ministry}</option>
                  <option value="scheme">{strings.common.scheme}</option>
                  <option value="national">{strings.overview.heroEyebrow}</option>
                </select>
              </label>

              <label className="block">
                <span className="eyebrow mb-1.5 block">{strings.corrections.fyLabel}</span>
                <input
                  type="text"
                  name="fy"
                  inputMode="text"
                  placeholder="FY2026"
                  className="figure w-full border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper)] px-3 py-2 text-[14px]"
                />
              </label>
            </div>

            <label className="block">
              <span className="eyebrow mb-1.5 block">{strings.corrections.entityIdLabel}</span>
              <input
                type="text"
                name="entityId"
                className="figure w-full border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper)] px-3 py-2 text-[14px]"
              />
            </label>

            <label className="block">
              <span className="eyebrow mb-1.5 block">{strings.corrections.noteLabel}</span>
              <textarea
                name="note"
                required
                rows={7}
                className="w-full border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper)] px-3 py-2 text-[14px] leading-relaxed"
              />
            </label>

            <label className="block">
              <span className="eyebrow mb-1.5 block">{strings.corrections.contactLabel}</span>
              <input
                type="text"
                name="contact"
                autoComplete="off"
                className="w-full border border-[color:var(--color-rule-strong)] bg-[color:var(--color-paper)] px-3 py-2 text-[14px]"
              />
              <span className="mt-1.5 block text-[12px] text-[color:var(--color-ink-faint)]">
                {strings.corrections.contactHelp}
              </span>
            </label>

            <button
              type="submit"
              className="border border-[color:var(--color-ink)] bg-[color:var(--color-ink)] px-4 py-2 text-[13px] font-medium text-[color:var(--color-paper)]"
            >
              {strings.corrections.submit}
            </button>
          </form>
        </Section>

        <Section title={strings.corrections.policyTitle}>
          <Callout>
            <p>{strings.corrections.policyBody}</p>
          </Callout>
          <div className="prose-civic mt-4">
            <p>{strings.methodology.correctionsBody}</p>
            <p>
              <a href="/methodology">{strings.nav.methodology}</a>
            </p>
          </div>
        </Section>
      </div>
    </PageShell>
  );
}
