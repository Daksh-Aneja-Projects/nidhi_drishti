import { ArrowDown, ArrowUp } from 'lucide-react';
import { isNotReported, type Amount, type MinistrySummary } from '@nidhi/core';
import { Figure } from '@/components/figure';
import { Icon } from '@/components/icon';
import { Link } from '@/components/locale-link';
import { PaceChip } from '@/components/pace-track';
import { TableScroll } from '@/components/layout-primitives';
import { getStrings } from '@/lib/i18n-server';

/**
 * The ministry register.
 *
 * Sorting lives in the query string rather than in client state, for the same
 * reason the financial year does: a journalist who sorts by balance and sends
 * the link should have the recipient land on the same view. It also keeps this
 * a server component, so every figure keeps its provenance affordance without
 * shipping the whole table to the browser.
 *
 * Unreported figures sort last in both directions. An entity with no figure is
 * not the smallest one.
 */

export const MINISTRY_SORT_KEYS = [
  'name',
  'authority',
  'spent',
  'balance',
  'pace',
  'signals',
] as const;

export type MinistrySort = (typeof MINISTRY_SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveMinistrySort(
  rawSort: string | string[] | undefined,
  rawDir: string | string[] | undefined,
): { sort: MinistrySort; dir: SortDirection } {
  const sortCandidate = first(rawSort);
  const dirCandidate = first(rawDir);
  const sort = (MINISTRY_SORT_KEYS as readonly string[]).includes(sortCandidate ?? '')
    ? (sortCandidate as MinistrySort)
    : 'authority';
  const dir: SortDirection = dirCandidate === 'asc' ? 'asc' : 'desc';
  return { sort, dir };
}

function amountKey(value: Amount): number | null {
  return isNotReported(value) ? null : value;
}

function pick(row: MinistrySummary, sort: MinistrySort): number | null {
  switch (sort) {
    case 'authority':
      return amountKey(row.currentAuthority);
    case 'spent':
      return amountKey(row.expenditureToDate);
    case 'balance':
      return amountKey(row.balance);
    case 'pace':
      return amountKey(row.burn.burnRatio);
    case 'signals':
      return row.openFlagCount;
    default:
      return null;
  }
}

export function sortMinistries(
  rows: readonly MinistrySummary[],
  sort: MinistrySort,
  dir: SortDirection,
): MinistrySummary[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sort === 'name') return sign * a.name.localeCompare(b.name, 'en-IN');
    const left = pick(a, sort);
    const right = pick(b, sort);
    if (left === null && right === null) return a.name.localeCompare(b.name, 'en-IN');
    if (left === null) return 1;
    if (right === null) return -1;
    if (left === right) return a.name.localeCompare(b.name, 'en-IN');
    return sign * (left - right);
  });
}

interface MinistryTableProps {
  rows: readonly MinistrySummary[];
  fy: string;
  sort: MinistrySort;
  dir: SortDirection;
  /** Path the sort links point back at. */
  basePath?: string;
}

export async function MinistryTable({
  rows,
  fy,
  sort,
  dir,
  basePath = '/ministries',
}: MinistryTableProps) {
  const strings = await getStrings();
  const columns: Array<{ key: MinistrySort; label: string; numeric: boolean }> = [
    { key: 'name', label: strings.ministries.colName, numeric: false },
    { key: 'authority', label: strings.ministries.colAuthority, numeric: true },
    { key: 'spent', label: strings.ministries.colSpent, numeric: true },
    { key: 'balance', label: strings.ministries.colBalance, numeric: true },
    { key: 'pace', label: strings.ministries.colPace, numeric: false },
    { key: 'signals', label: strings.ministries.colSignals, numeric: true },
  ];
  const sorted = sortMinistries(rows, sort, dir);

  return (
    <TableScroll>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const active = column.key === sort;
              const nextDir: SortDirection = active && dir === 'desc' ? 'asc' : 'desc';
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
                    {active ? (
                      <Icon icon={dir === 'asc' ? ArrowUp : ArrowDown} size="xs" />
                    ) : null}
                  </Link>
                </th>
              );
            })}
            <th scope="col">{strings.ministries.colSector}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.ministryId}>
              <td className="max-w-[26rem]">
                <Link
                  href={`/ministry/${encodeURIComponent(row.ministryId)}?fy=${fy}`}
                  className="underline decoration-[color:var(--color-rule-strong)] underline-offset-2 transition-colors hover:text-[color:var(--color-behind)]"
                >
                  {row.name}
                </Link>
              </td>
              <td className="num">
                <Figure
                  value={row.currentAuthority}
                  scale="dense"
                  provenance={row.provenance.authority}
                  metric={strings.stage.authority}
                  entityId={row.ministryId}
                  stage="RE"
                />
              </td>
              <td className="num">
                <Figure
                  value={row.expenditureToDate}
                  scale="dense"
                  provenance={row.provenance.expenditure}
                  metric={strings.stage.spent}
                  entityId={row.ministryId}
                  stage="EXPENDITURE"
                />
              </td>
              <td className="num">
                <Figure value={row.balance} scale="dense" />
              </td>
              <td>
                <PaceChip burn={row.burn} label={row.name} />
              </td>
              <td className="num">{row.openFlagCount}</td>
              <td className="text-[13px] text-[color:var(--color-ink-faint)]">
                {row.sector ?? strings.common.notStated}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
