import type { Metadata } from 'next';
import { Activity } from 'lucide-react';
import {
  getSourceFreshness,
  listRecentPipelineRuns,
  runInvariantChecks,
  type InvariantFinding,
} from '@nidhi/db';
import type { PipelineRun, PipelineRunStatus, SourceFreshness } from '@nidhi/core';
import {
  Callout,
  Chip,
  EmptyState,
  PageHeader,
  PageShell,
  Section,
  TableScroll,
} from '@/components/layout-primitives';
import { formatAge, formatIstDateTime } from '@/lib/format';
import { hasInternalAccess } from '@/lib/api';
import { getLocale, getStrings } from '@/lib/i18n-server';
import type { Strings } from '@/lib/strings';
import { resolveFy } from '@/lib/site';

/**
 * The internal operations view (docs/09 plane B): runs by status, source
 * staleness, parse errors, and the invariant checks.
 *
 * Gated on the shared secret in ADMIN_REVIEW_TOKEN. When the token does not
 * match, the page renders a plain notice and queries nothing at all, so a
 * probe of this address cannot even establish whether the database is up.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const strings = await getStrings();
  return {
    title: strings.ops.title,
    robots: { index: false, follow: false },
  };
}

const RUN_LIMIT = 100;

function readMetric(run: PipelineRun, key: string): number | null {
  const value = run.metrics[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function durationSeconds(run: PipelineRun, strings: Strings): string {
  if (!run.finishedAt) return strings.common.loading;
  const seconds = (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000;
  return Number.isFinite(seconds) ? `${Math.max(0, Math.round(seconds))}s` : strings.common.notReported;
}

function statusTone(status: PipelineRunStatus): 'neutral' | 'seal' | 'muted' {
  return status === 'ok' ? 'neutral' : status === 'running' ? 'muted' : 'seal';
}

function severityTone(severity: InvariantFinding['severity']): 'neutral' | 'seal' | 'muted' {
  return severity === 'error' ? 'seal' : severity === 'warn' ? 'neutral' : 'muted';
}

export default async function OpsPage() {
  const [strings, locale] = await Promise.all([getStrings(), getLocale()]);
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

  let runs: PipelineRun[] = [];
  let freshness: SourceFreshness[] = [];
  let invariants: InvariantFinding[] = [];
  let unavailable = false;

  try {
    const { fy } = await resolveFy();
    [runs, freshness, invariants] = await Promise.all([
      listRecentPipelineRuns(RUN_LIMIT),
      getSourceFreshness(),
      runInvariantChecks(fy),
    ]);
  } catch (error) {
    console.error('[ops] could not read operational state', error);
    unavailable = true;
  }

  const byStatus = new Map<PipelineRunStatus, number>();
  for (const run of runs) byStatus.set(run.status, (byStatus.get(run.status) ?? 0) + 1);

  const parseErrors = new Map<string, number>();
  for (const run of runs) {
    const count = readMetric(run, 'parse_error_count');
    if (count && count > 0) {
      parseErrors.set(run.sourceId, (parseErrors.get(run.sourceId) ?? 0) + count);
    }
  }

  return (
    <PageShell>
      <PageHeader eyebrow={strings.ops.eyebrow} title={strings.ops.title} lede={strings.ops.lede} />

      {unavailable ? (
        <Callout tone="caution">
          <p>{strings.ops.unavailable}</p>
        </Callout>
      ) : null}

      <Section title={strings.ops.statusTitle}>
        {byStatus.size === 0 ? (
          <EmptyState icon={Activity} title={strings.ops.runsEmpty} body={strings.ops.lede} />
        ) : (
          <div className="flex flex-wrap gap-8">
            {[...byStatus.entries()].map(([status, count]) => (
              <div key={status}>
                <p className="eyebrow mb-1">{status}</p>
                <p className="figure text-2xl font-medium">{count}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={strings.ops.stalenessTitle}>
        {freshness.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-ink-faint)]">
            {strings.ops.stalenessEmpty}
          </p>
        ) : (
          <TableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{strings.ops.runSource}</th>
                  <th scope="col">{strings.sourcesPage.cadence}</th>
                  <th scope="col">{strings.freshness.lastFetched}</th>
                  <th scope="col">{strings.ops.runStatus}</th>
                </tr>
              </thead>
              <tbody>
                {freshness.map((source) => (
                  <tr key={source.sourceId}>
                    <td>
                      <span className="font-medium">{source.name}</span>
                      <span className="figure ml-2 text-[11.5px] text-[color:var(--color-ink-faint)]">
                        {source.sourceId}
                      </span>
                    </td>
                    <td className="text-[13px] text-[color:var(--color-ink-soft)]">
                      {source.cadence}
                    </td>
                    <td className="text-[13px] text-[color:var(--color-ink-soft)]">
                      {formatAge(source.hoursSinceFetch, locale)}
                    </td>
                    <td>
                      {source.isStale ? (
                        <Chip tone="seal">{strings.freshness.stale}</Chip>
                      ) : (
                        <Chip tone="muted">{source.lastRunStatus ?? strings.freshness.never}</Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Section>

      <Section title={strings.ops.parseErrorsTitle}>
        {parseErrors.size === 0 ? (
          <p className="text-[13px] text-[color:var(--color-ink-faint)]">
            {strings.ops.parseErrorsEmpty}
          </p>
        ) : (
          <ul>
            {[...parseErrors.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([sourceId, count]) => (
                <li key={sourceId} className="band flex items-baseline justify-between py-2.5">
                  <span className="figure text-[13px]">{sourceId}</span>
                  <span className="figure text-[13px] font-medium">{count}</span>
                </li>
              ))}
          </ul>
        )}
      </Section>

      <Section title={strings.ops.invariantsTitle}>
        {invariants.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-ink-faint)]">
            {strings.ops.invariantsEmpty}
          </p>
        ) : (
          <TableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{strings.ops.invariant}</th>
                  <th scope="col">{strings.ops.severity}</th>
                  <th scope="col">{strings.common.fiscalYear}</th>
                  <th scope="col">{strings.ops.entity}</th>
                  <th scope="col">{strings.ops.detail}</th>
                </tr>
              </thead>
              <tbody>
                {invariants.map((finding, index) => (
                  <tr key={`${finding.invariant}-${finding.entityId ?? index}`}>
                    <td className="figure text-[12.5px]">{finding.invariant}</td>
                    <td>
                      <Chip tone={severityTone(finding.severity)}>{finding.severity}</Chip>
                    </td>
                    <td className="figure text-[12.5px]">{finding.fy ?? ''}</td>
                    <td className="figure text-[12.5px]">{finding.entityId ?? ''}</td>
                    <td className="max-w-[52ch] text-[13px] text-[color:var(--color-ink-soft)]">
                      {finding.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Section>

      <Section title={strings.ops.runsTitle}>
        {runs.length === 0 ? (
          <p className="text-[13px] text-[color:var(--color-ink-faint)]">{strings.ops.runsEmpty}</p>
        ) : (
          <TableScroll>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{strings.ops.runSource}</th>
                  <th scope="col">{strings.ops.runStatus}</th>
                  <th scope="col">{strings.ops.runStarted}</th>
                  <th scope="col" className="num">
                    {strings.ops.runDuration}
                  </th>
                  <th scope="col" className="num">
                    {strings.ops.runRows}
                  </th>
                  <th scope="col" className="num">
                    {strings.ops.runErrors}
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.runId}>
                    <td className="figure text-[12.5px]">{run.sourceId}</td>
                    <td>
                      <Chip tone={statusTone(run.status)}>{run.status}</Chip>
                    </td>
                    <td className="text-[13px] text-[color:var(--color-ink-soft)]">
                      {formatIstDateTime(run.startedAt, locale)}
                    </td>
                    <td className="num text-[13px]">{durationSeconds(run, strings)}</td>
                    <td className="num text-[13px]">{readMetric(run, 'row_count') ?? ''}</td>
                    <td className="num text-[13px]">{readMetric(run, 'parse_error_count') ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Section>
    </PageShell>
  );
}
