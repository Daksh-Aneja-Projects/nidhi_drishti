import type { Metadata } from 'next';
import Link from 'next/link';
import { Columns3, X } from 'lucide-react';
import {
  NOT_REPORTED,
  formatPercent,
  type Amount,
  type FiscalYear,
  type MinistrySummary,
  type Provenance,
  type SchemeSummary,
} from '@nidhi/core';
import {
  getMinistrySummary,
  getSchemeSummary,
  listMinistrySummaries,
  listSchemeSummaries,
} from '@nidhi/db';
import {
  Callout,
  EmptyState,
  PageHeader,
  PageShell,
  Section,
  TableScroll,
} from '@/components/layout-primitives';
import { Figure } from '@/components/figure';
import { Icon } from '@/components/icon';
import { CompareTracker } from '@/app/compare/compare-tracker';
import { resolveFy } from '@/lib/site';
import { strings } from '@/lib/strings';

/**
 * Compare up to four ministries or schemes.
 *
 * The selection lives in the address as repeated `e=type:id` parameters, so a
 * comparison is a link somebody can send to an editor. Adding and removing is
 * done with plain links rather than client state, which keeps the page working
 * without scripting and keeps every view of it shareable.
 *
 * Ministries and schemes report different stages, so the aligned table shows
 * "Not reported" where a side genuinely does not publish a measure. It never
 * borrows the other side's number to fill the cell.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: strings.compare.title,
  description: strings.compare.lede,
};

const MAX_ENTITIES = 4;

type Selection = { type: 'ministry' | 'scheme'; id: string };

type Loaded =
  | { kind: 'ministry'; key: string; summary: MinistrySummary }
  | { kind: 'scheme'; key: string; summary: SchemeSummary };

function parseSelection(raw: string | string[] | undefined): Selection[] {
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const out: Selection[] = [];
  const seen = new Set<string>();
  for (const value of values.flatMap((item) => item.split(','))) {
    const [type, ...rest] = value.split(':');
    const id = rest.join(':').trim();
    if ((type !== 'ministry' && type !== 'scheme') || id === '') continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, id });
    if (out.length === MAX_ENTITIES) break;
  }
  return out;
}

function hrefFor(selections: Selection[], fy: FiscalYear): string {
  const params = new URLSearchParams();
  params.set('fy', fy);
  for (const selection of selections) params.append('e', `${selection.type}:${selection.id}`);
  return `/compare?${params.toString()}`;
}

interface MetricRow {
  label: string;
  help?: string;
  cell: (entity: Loaded) => { value: Amount; provenance?: Provenance | null; percent?: boolean };
}

const ROWS: readonly MetricRow[] = [
  {
    label: strings.stage.authority,
    help: strings.stage.authorityHelp,
    cell: (entity) =>
      entity.kind === 'ministry'
        ? { value: entity.summary.currentAuthority, provenance: entity.summary.provenance.authority }
        : { value: entity.summary.allocation, provenance: entity.summary.provenance.allocation },
  },
  {
    label: 'Released',
    cell: (entity) =>
      entity.kind === 'scheme'
        ? { value: entity.summary.released, provenance: entity.summary.provenance.released }
        : { value: NOT_REPORTED },
  },
  {
    label: strings.stage.spent,
    help: strings.stage.spentHelp,
    cell: (entity) =>
      entity.kind === 'ministry'
        ? {
            value: entity.summary.expenditureToDate,
            provenance: entity.summary.provenance.expenditure,
          }
        : { value: entity.summary.utilized, provenance: entity.summary.provenance.utilized },
  },
  {
    label: strings.stage.balance,
    help: strings.stage.balanceHelp,
    cell: (entity) =>
      entity.kind === 'ministry'
        ? { value: entity.summary.balance }
        : { value: NOT_REPORTED },
  },
  {
    label: 'Share of the allocation reported spent',
    cell: (entity) =>
      entity.kind === 'ministry'
        ? { value: entity.summary.burn.pctSpent, percent: true }
        : { value: entity.summary.utilizationPct, percent: true },
  },
  {
    label: strings.pace.label,
    help: strings.pace.help,
    cell: (entity) =>
      entity.kind === 'ministry'
        ? { value: entity.summary.burn.burnRatio }
        : { value: NOT_REPORTED },
  },
];

async function loadEntities(selections: Selection[], fy: FiscalYear): Promise<Loaded[]> {
  const loaded = await Promise.all(
    selections.map(async (selection): Promise<Loaded | null> => {
      if (selection.type === 'ministry') {
        const summary = await getMinistrySummary(fy, selection.id);
        return summary ? { kind: 'ministry', key: `ministry:${selection.id}`, summary } : null;
      }
      const summary = await getSchemeSummary(fy, selection.id);
      return summary ? { kind: 'scheme', key: `scheme:${selection.id}`, summary } : null;
    }),
  );
  return loaded.filter((entity): entity is Loaded => entity !== null);
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { fy } = await resolveFy(params.fy);
  const selections = parseSelection(params.e);

  let entities: Loaded[] = [];
  let ministryOptions: MinistrySummary[] = [];
  let schemeOptions: SchemeSummary[] = [];
  try {
    [entities, ministryOptions, schemeOptions] = await Promise.all([
      loadEntities(selections, fy),
      listMinistrySummaries(fy, { orderBy: 'allocation', limit: 40 }),
      listSchemeSummaries(fy, { orderBy: 'allocation', limit: 40 }),
    ]);
  } catch (error) {
    console.error('[compare] could not load entities', error);
  }

  const current = entities.map((entity): Selection => ({
    type: entity.kind,
    id: entity.kind === 'ministry' ? entity.summary.ministryId : entity.summary.schemeId,
  }));
  const full = current.length >= MAX_ENTITIES;

  const addHref = (selection: Selection) =>
    full ? hrefFor(current, fy) : hrefFor([...current, selection], fy);
  const removeHref = (key: string) =>
    hrefFor(
      current.filter((item) => `${item.type}:${item.id}` !== key),
      fy,
    );

  const selectedKeys = new Set(current.map((item) => `${item.type}:${item.id}`));

  return (
    <PageShell>
      <CompareTracker count={entities.length} />
      <PageHeader
        eyebrow={strings.compare.eyebrow}
        title={strings.compare.title}
        lede={strings.compare.lede}
        actions={
          current.length > 0 ? (
            <Link
              href={hrefFor([], fy)}
              className="text-[13px] text-[color:var(--color-ink-soft)] underline underline-offset-2"
            >
              {strings.compare.clear}
            </Link>
          ) : null
        }
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <Section title={strings.compare.title} help={strings.compare.mixedNote}>
            {entities.length === 0 ? (
              <EmptyState
                icon={Columns3}
                title={strings.compare.empty}
                body={strings.compare.emptyBody}
                action={{ href: '/ministries', label: strings.nav.ministries }}
              />
            ) : (
              <TableScroll>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{strings.compare.metric}</th>
                      {entities.map((entity) => (
                        <th key={entity.key} scope="col" className="num">
                          <span className="block normal-case tracking-normal">
                            {entity.summary.name}
                          </span>
                          <Link
                            href={removeHref(entity.key)}
                            className="mt-1 inline-flex items-center gap-1 text-[11px] font-normal text-[color:var(--color-ink-faint)]"
                          >
                            <Icon icon={X} size="xs" />
                            {strings.compare.remove}
                          </Link>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => (
                      <tr key={row.label}>
                        <th scope="row" className="text-left align-top">
                          <span className="block font-medium normal-case tracking-normal text-[color:var(--color-ink)]">
                            {row.label}
                          </span>
                          {row.help ? (
                            <span className="mt-1 block max-w-[34ch] whitespace-normal text-[11.5px] font-normal leading-snug text-[color:var(--color-ink-faint)]">
                              {row.help}
                            </span>
                          ) : null}
                        </th>
                        {entities.map((entity) => {
                          const cell = row.cell(entity);
                          const entityId =
                            entity.kind === 'ministry'
                              ? entity.summary.ministryId
                              : entity.summary.schemeId;
                          return (
                            <td key={entity.key} className="num align-top">
                              {cell.percent ? (
                                <span className="figure text-[13px]">
                                  {formatPercent(cell.value)}
                                </span>
                              ) : (
                                <Figure
                                  value={cell.value}
                                  scale="dense"
                                  provenance={cell.provenance ?? null}
                                  metric={row.label}
                                  entityId={entityId}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}

            {full ? (
              <div className="mt-4">
                <Callout>
                  <p>{strings.compare.full}</p>
                </Callout>
              </div>
            ) : null}
          </Section>
        </div>

        <div>
          <Section title={strings.compare.addMinistry}>
            <ul className="max-h-[22rem] overflow-y-auto">
              {ministryOptions.map((ministry) => {
                const key = `ministry:${ministry.ministryId}`;
                const selected = selectedKeys.has(key);
                return (
                  <li key={key} className="band py-2">
                    {selected ? (
                      <span className="text-[13px] text-[color:var(--color-ink-faint)]">
                        {ministry.name}
                      </span>
                    ) : (
                      <Link
                        href={addHref({ type: 'ministry', id: ministry.ministryId })}
                        className="text-[13px] text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-ink)]"
                      >
                        {ministry.name}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title={strings.compare.addScheme}>
            <ul className="max-h-[22rem] overflow-y-auto">
              {schemeOptions.map((scheme) => {
                const key = `scheme:${scheme.schemeId}`;
                const selected = selectedKeys.has(key);
                return (
                  <li key={key} className="band py-2">
                    {selected ? (
                      <span className="text-[13px] text-[color:var(--color-ink-faint)]">
                        {scheme.name}
                      </span>
                    ) : (
                      <Link
                        href={addHref({ type: 'scheme', id: scheme.schemeId })}
                        className="text-[13px] text-[color:var(--color-ink-soft)] hover:text-[color:var(--color-ink)]"
                      >
                        {scheme.name}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        </div>
      </div>
    </PageShell>
  );
}
