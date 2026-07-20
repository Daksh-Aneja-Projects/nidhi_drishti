import type { Metadata } from 'next';
import {
  ANALYTICS_EVENT_NAMES,
  ANOMALY_RULES,
  FISCAL_STAGES,
  FISCAL_STAGE_DESCRIPTIONS,
  FISCAL_STAGE_LABELS,
} from '@nidhi/core';
import {
  Callout,
  PageHeader,
  PageShell,
  Section,
  TableScroll,
} from '@/components/layout-primitives';
import { Link } from '@/components/locale-link';
import { getStrings } from '@/lib/i18n-server';

/**
 * The methodology page docs/08 requires: rules, sources, limitations, the
 * corrections policy, and the usage measurement taxonomy.
 *
 * The taxonomy is read from `ANALYTICS_EVENT_NAMES` in @nidhi/core rather than
 * from the web app's analytics module, because that module is a client module
 * and this page is rendered on the server. Reading it from the shared contract
 * also means the published list cannot drift from the list actually collected.
 */

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return {
    title: strings.methodology.title,
    description: strings.methodology.lede,
  };
}

export default async function MethodologyPage() {
  const strings = await getStrings();
  return (
    <PageShell>
      <PageHeader
        eyebrow={strings.methodology.eyebrow}
        title={strings.methodology.title}
        lede={strings.methodology.lede}
      />

      <Section title={strings.methodology.pipelineTitle}>
        <ol className="max-w-[68ch]">
          {strings.methodology.pipelineSteps.map((step, index) => (
            <li key={step} className="band flex gap-4 py-3.5">
              <span className="figure w-6 shrink-0 text-[13px] text-[color:var(--color-ink-faint)]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="text-[14px] leading-relaxed text-[color:var(--color-ink-soft)]">
                {step}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={strings.methodology.stagesTitle} help={strings.methodology.stagesBody}>
        <TableScroll>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{strings.methodology.stageColumn}</th>
                <th scope="col">{strings.methodology.meaningColumn}</th>
              </tr>
            </thead>
            <tbody>
              {FISCAL_STAGES.map((stage) => (
                <tr key={stage}>
                  <td className="whitespace-nowrap font-medium">{FISCAL_STAGE_LABELS[stage]}</td>
                  <td className="max-w-[60ch] text-[13px] text-[color:var(--color-ink-soft)]">
                    {FISCAL_STAGE_DESCRIPTIONS[stage]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Section>

      <Section title={strings.methodology.rulesTitle} help={strings.methodology.rulesBody}>
        <div>
          {Object.values(ANOMALY_RULES).map((rule) => (
            <div key={rule.ruleId} className="band py-5">
              <h3 className="font-display text-[15px]">{rule.label}</h3>
              <p className="mt-1.5 max-w-[68ch] text-[13.5px] leading-relaxed text-[color:var(--color-ink-soft)]">
                {rule.description}
              </p>
              <p className="eyebrow mt-3">{strings.flags.doesNotProve}</p>
              <p className="mt-1 max-w-[68ch] text-[13px] leading-relaxed text-[color:var(--color-ink-faint)]">
                {rule.doesNotProve}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <Callout tone="caution" title={strings.methodology.rulesLimitTitle}>
            <p>{strings.methodology.rulesLimitBody}</p>
          </Callout>
        </div>
      </Section>

      <Section title={strings.methodology.limitsTitle}>
        <ul className="max-w-[70ch]">
          {strings.methodology.limits.map((limit) => (
            <li key={limit} className="band py-3.5 text-[14px] leading-relaxed text-[color:var(--color-ink-soft)]">
              {limit}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={strings.methodology.correctionsTitle}>
        <div className="prose-civic">
          <p>{strings.methodology.correctionsBody}</p>
          <p>
            <Link href="/corrections">{strings.footer.corrections}</Link>
          </p>
        </div>
      </Section>

      <Section
        title={strings.methodology.analyticsTitle}
        help={strings.methodology.analyticsBody}
      >
        <p className="eyebrow mb-2">{strings.methodology.analyticsEventsTitle}</p>
        <ul className="flex flex-wrap gap-2">
          {ANALYTICS_EVENT_NAMES.map((event) => (
            <li
              key={event}
              className="figure border border-[color:var(--color-rule-strong)] px-2 py-1 text-[12px] text-[color:var(--color-ink-soft)]"
            >
              {event}
            </li>
          ))}
        </ul>
      </Section>
    </PageShell>
  );
}
