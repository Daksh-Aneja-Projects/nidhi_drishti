import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  NOT_REPORTED,
  isNotReported,
  type Amount,
  type BurnMetrics,
  type StateEntity,
  type StateSummary,
} from '@nidhi/core';
import { Figure } from '@/components/figure';
import { Icon } from '@/components/icon';
import { Link } from '@/components/locale-link';
import { PaceChip } from '@/components/pace-track';
import { Chip, TableScroll } from '@/components/layout-primitives';
import { getStrings } from '@/lib/i18n-server';

/**
 * The state register.
 *
 * One row per state and union territory from the reference list, joined to the
 * summary for the year where one exists. Most rows have no summary yet: state
 * ingestion begins with two states, and a state with nothing ingested renders
 * "Not reported" rather than being dropped, so the index stays a complete map
 * of the country rather than a list of two.
 *
 * Union territories without a legislative assembly present no budget of their
 * own, so their figure cells carry that fact instead of "Not reported", which
 * would wrongly imply an unreported treasury.
 *
 * Sorting lives in the query string, exactly as the ministry register does, so
 * a sorted view is a link. Unreported figures sort last in both directions.
 */

export const STATE_SORT_KEYS = ['name', 'authority', 'spent', 'balance', 'pace'] as const;

export type StateSort = (typeof STATE_SORT_KEYS)[number];
export type StateSortDirection = 'asc' | 'desc';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveStateSort(
  rawSort: string | string[] | undefined,
  rawDir: string | string[] | undefined,
): { sort: StateSort; dir: StateSortDirection } {
  const sortCandidate = first(rawSort);
  const dirCandidate = first(rawDir);
  const sort = (STATE_SORT_KEYS as readonly string[]).includes(sortCandidate ?? '')
    ? (sortCandidate as StateSort)
    : 'name';
  const dir: StateSortDirection = dirCandidate === 'desc' ? 'desc' : 'asc';
  return { sort, dir };
}

/** A reference-list state with its year summary, where one has been ingested. */
export interface StateRowData {
  entity: StateEntity;
  summary: StateSummary | null;
}

const UNREPORTED_BURN: BurnMetrics = {
  pctSpent: NOT_REPORTED,
  pctFyElapsed: 0,
  burnRatio: NOT_REPORTED,
};

function amountKey(value: Amount | undefined): number | null {
  return value === undefined || isNotReported(value) ? null : value;
}

function pick(row: StateRowData, sort: StateSort): number | null {
  switch (sort) {
    case 'authority':
      return amountKey(row.summary?.currentAuthority);
    case 'spent':
      return amountKey(row.summary?.expenditureToDate);
    case 'balance':
      return amountKey(row.summary?.balance);
    case 'pace':
      return amountKey(row.summary?.burn.burnRatio);
    default:
      return null;
  }
}

export function sortStateRows(
  rows: readonly StateRowData[],
  sort: StateSort,
  dir: StateSortDirection,
): StateRowData[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort === 'name') return sign * a.entity.name.localeCompare(b.entity.name, 'en-IN');
    const left = pick(a, sort);
    const right = pick(b, sort);
    if (left === null && right === null) return a.entity.name.localeCompare(b.entity.name, 'en-IN');
    if (left === null) return 1;
    if (right === null) return -1;
    if (left === right) return a.entity.name.localeCompare(b.entity.name, 'en-IN');
    return sign * (left - right);
  });
}

interface StateTableProps {
  rows: readonly StateRowData[];
  fy: string;
  sort: StateSort;
  dir: StateSortDirection;
  /** Path the sort links point back at. */
  basePath?: string;
}

export async function StateTable({ rows, fy, sort, dir, basePath = '/states' }: StateTableProps) {
  const strings = await getStrings();
  const columns: Array<{ key: StateSort; label: string; numeric: boolean }> = [
    { key: 'name', label: strings.states.colName, numeric: false },
    { key: 'authority', label: strings.states.colAuthority, numeric: true },
    { key: 'spent', label: strings.states.colSpent, numeric: true },
    { key: 'balance', label: strings.states.colBalance, numeric: true },
    { key: 'pace', label: strings.states.colPace, numeric: false },
  ];
  const sorted = sortStateRows(rows, sort, dir);

  return (
    <TableScroll>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = column.key === sort;
              const nextDir: StateSortDirection = active && dir === 'desc' ? 'asc' : 'desc';
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={column.numeric ? 'num' : undefined}
                  aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <Link
                    href={`${basePath}?fy=${fy}&sort=${column.key}&dir=${nextDir}`}
                    className="inline-flex items-center gap-1 transition-colors hover:text-[color:var(--color-ink)]"
                    aria-label={`${column.label}. ${
                      nextDir === 'asc' ? strings.common.sortAscending : strings.common.sortDescending
                    }`}
                  >
                    {column.label}
                    {active ? <Icon icon={dir === 'asc' ? ArrowUp : ArrowDown} size="xs" /> : null}
                  </Link>
                </th>
              );
            })}
            <th scope="col">{strings.states.colRegion}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ entity, summary }) => (
            <tr key={entity.stateId}>
              <td className="max-w-[26rem]">
                <Link
                  href={`/state/${encodeURIComponent(entity.stateId)}?fy=${fy}`}
                  className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2 transition-colors hover:text-[color:var(--color-behind)]"
                >
                  {entity.name}
                </Link>
                {entity.kind === 'ut' ? (
                  <span className="ml-2">
                    <Chip tone="muted">{strings.states.kindUt}</Chip>
                  </span>
                ) : null}
              </td>
              {entity.hasLegislature ? (
                <>
                  <td className="num">
                    <Figure
                      value={summary?.currentAuthority ?? NOT_REPORTED}
                      scale="dense"
                      provenance={summary?.provenance.authority ?? null}
                      metric={strings.states.colAuthority}
                      entityId={entity.stateId}
                      stage="RE"
                    />
                  </td>
                  <td className="num">
                    <Figure
                      value={summary?.expenditureToDate ?? NOT_REPORTED}
                      scale="dense"
                      provenance={summary?.provenance.expenditure ?? null}
                      metric={strings.states.colSpent}
                      entityId={entity.stateId}
                      stage="EXPENDITURE"
                    />
                  </td>
                  <td className="num">
                    <Figure value={summary?.balance ?? NOT_REPORTED} scale="dense" />
                  </td>
                  <td>
                    <PaceChip burn={summary?.burn ?? UNREPORTED_BURN} label={entity.name} />
                  </td>
                </>
              ) : (
                // No legislative assembly means no budget of its own; the cell
                // says so rather than showing "Not reported", which would imply
                // a state treasury that does not exist (docs/12 section 4).
                <td colSpan={4} className="text-[13px] text-[color:var(--color-ink-faint)]">
                  {strings.states.viaUnion}
                </td>
              )}
              <td className="text-[13px] text-[color:var(--color-ink-faint)]">
                {entity.region ?? strings.common.notStated}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
