import { getISOWeek } from 'date-fns';
import type { CategorizedEntryRow } from './data';
import type { ParetoDatum } from '../components/ParetoChart';

export const PIVOT_FIELDS = [
  { key: 'category', label: 'Category' },
  { key: 'shift', label: 'Shift' },
  { key: 'week', label: 'Week' },
];

export function pivotFieldLabel(key: string): string {
  return PIVOT_FIELDS.find((f) => f.key === key)?.label ?? key;
}

export function pivotDimValue(e: CategorizedEntryRow, key: string): string {
  switch (key) {
    case 'category':
      return e.category;
    case 'shift':
      return e.shift ?? 'Unspecified';
    case 'week':
      return `Wk ${getISOWeek(new Date(e.entry_date))}`;
    default:
      return '';
  }
}

export function applyPivotFilter(entries: CategorizedEntryRow[], filterField: string | null | undefined, filterValues: string[] | null | undefined): CategorizedEntryRow[] {
  if (!filterField || !filterValues || filterValues.length === 0) return entries;
  const set = new Set(filterValues);
  return entries.filter((e) => set.has(pivotDimValue(e, filterField)));
}

export function computeChartData(entries: CategorizedEntryRow[], rowField: string): ParetoDatum[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const label = pivotDimValue(e, rowField);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([label, count]) => ({ label, count }));
}

export interface CrossTab {
  rows: string[];
  cols: string[];
  grid: Map<string, number>;
}

export function computeCrossTab(entries: CategorizedEntryRow[], rowField: string, colField: string): CrossTab {
  const rowLabels = new Set<string>();
  const colLabels = new Set<string>();
  const grid = new Map<string, number>();
  for (const e of entries) {
    const r = pivotDimValue(e, rowField);
    const c = pivotDimValue(e, colField);
    rowLabels.add(r);
    colLabels.add(c);
    grid.set(`${r}\u0000${c}`, (grid.get(`${r}\u0000${c}`) ?? 0) + 1);
  }
  return { rows: Array.from(rowLabels).sort(), cols: Array.from(colLabels).sort(), grid };
}
